import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Binary content the database only references, addressed by a key in one
 * S3-compatible bucket:
 *
 *   images/<xx>/<sha256>                         images, by content digest
 *   image-regions/<sha256>/<recipe>/<region>.png  derived image evidence
 *   model-artifacts/<upload-id>/<sha256>         immutable model delivery
 *   training-artifact-parts/<run>/<attempt>/... pending final-model parts
 *
 * Images are content addressed, so identical uploads share one object and
 * snapshots reference images without copying them. Objects are immutable: a
 * key is written once and read until nothing refers to it any more, so a
 * reader never observes a partial write and no key needs a version.
 */

/** An object store addressed by key; modules never depend on the driver. */
export interface BlobStore {
  read(key: string): Promise<Uint8Array | null>;
  open(key: string): Promise<OpenBlob | null>;
  putImmutable(key: string, contents: Uint8Array | string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
  /** Answers once the configured store accepts requests for its bucket. */
  reach(): Promise<void>;
}

/** A blob to stream, with the length its response declares. */
export interface OpenBlob {
  stream: ReadableStream<Uint8Array>;
  size: number;
}

/**
 * Keys name objects, not paths: no leading or repeated separator, no relative
 * segment, and no character a URL path would have to escape.
 */
const BLOB_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function assertKey(key: string): string {
  if (!BLOB_KEY.test(key) || key.split("/").includes("..")) {
    throw new Error(`Invalid blob key: ${key}`);
  }
  return key;
}

const MEMORY_URL = "memory://";

/**
 * `memory://` selects an in-process store that lives as long as the server.
 * Any HTTP(S) endpoint selects an S3-compatible store; the bucket has its own
 * setting and the AWS SDK obtains credentials and region through its standard
 * provider chain.
 */
function open(): BlobStore {
  const endpoint = process.env.VITROFLOW_BLOB_ENDPOINT;
  if (!endpoint) {
    throw new Error("VITROFLOW_BLOB_ENDPOINT is required");
  }
  if (endpoint === MEMORY_URL) return createMemoryBlobStore();
  const bucket = process.env.VITROFLOW_BLOB_BUCKET;
  if (!bucket) throw new Error("VITROFLOW_BLOB_BUCKET is required");
  return createS3BlobStore({ endpoint, bucket });
}

let store: BlobStore | undefined;

function blobs(): BlobStore {
  store ??= open();
  return store;
}

/**
 * Settles once the configured store answers for its bucket, so that a store
 * the server cannot reach fails the health check rather than the first upload.
 */
export function reachBlobStore(): Promise<void> {
  return blobs().reach();
}

export class ImmutableBlobConflictError extends Error {}

function bytes(contents: Uint8Array | string): Uint8Array {
  return typeof contents === "string"
    ? new TextEncoder().encode(contents)
    : new Uint8Array(contents);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && Buffer.from(left).equals(right)
  );
}

function conflict(key: string): ImmutableBlobConflictError {
  return new ImmutableBlobConflictError(
    `Blob ${key} already exists with different contents`,
  );
}

export function createMemoryBlobStore(): BlobStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async read(key) {
      const stored = objects.get(assertKey(key));
      return stored ? new Uint8Array(stored) : null;
    },
    async open(key) {
      const stored = objects.get(assertKey(key));
      if (!stored) return null;
      const content = new Uint8Array(stored);
      return { stream: bytesStream(content), size: content.byteLength };
    },
    async putImmutable(key, contents) {
      // A stored object is a copy, as it would be in a bucket: what the caller
      // does with its buffer afterwards cannot reach what readers see.
      const validKey = assertKey(key);
      const content = bytes(contents);
      const existing = objects.get(validKey);
      if (existing) {
        if (!sameBytes(existing, content)) throw conflict(validKey);
        return;
      }
      objects.set(validKey, content);
    },
    async exists(key) {
      return objects.has(assertKey(key));
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async remove(key) {
      objects.delete(assertKey(key));
    },
    async reach() {},
  };
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** One page of `list`; the paginator walks until the prefix is exhausted. */
const LIST_PAGE_KEYS = 1000;

/** What a store reports about a request, whether or not it names an error. */
function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

/** A store answers with 404 for a key it does not hold, whatever the verb. */
function absent(error: unknown): boolean {
  return statusOf(error) === 404;
}

/**
 * A bucket-level refusal often carries no message of its own, so the reason
 * names the store and what it answered rather than repeating an empty error.
 */
function unreachable(store: string, error: unknown): Error {
  const status = statusOf(error);
  const reason = status
    ? `answered ${status}`
    : `could not be reached (${error instanceof Error ? error.message : String(error)})`;
  return new Error(`Blob store ${store} ${reason}`, { cause: error });
}

interface S3BlobStoreOptions {
  endpoint: string;
  bucket: string;
  region?: string;
}

export function createS3BlobStore(options: S3BlobStoreOptions): BlobStore {
  const { bucket, endpoint, region } = s3Configuration(options);
  // The endpoint addresses one host, so the bucket belongs in the path rather
  // than in a subdomain the store would need wildcard DNS to answer for.
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
  });

  async function get(key: string) {
    try {
      return await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: assertKey(key) }),
      );
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }

  return {
    async read(key) {
      const object = await get(key);
      if (!object) return null;
      return object.Body!.transformToByteArray();
    },
    async open(key) {
      const object = await get(key);
      if (!object) return null;
      return {
        stream: object.Body!.transformToWebStream(),
        size: object.ContentLength!,
      };
    },
    async putImmutable(key, contents) {
      const validKey = assertKey(key);
      const content = bytes(contents);
      const request = new PutObjectCommand({
        Bucket: bucket,
        Key: validKey,
        Body: content,
        ContentLength: content.byteLength,
        IfNoneMatch: "*",
      });
      try {
        await client.send(request);
        return;
      } catch (error) {
        let failure = error;
        if (statusOf(error) === 409) {
          try {
            await client.send(request);
            return;
          } catch (retryError) {
            failure = retryError;
          }
        }
        if (statusOf(failure) !== 412) throw failure;
      }
      const existing = await get(validKey);
      if (!existing)
        throw new Error(`Blob ${validKey} disappeared after upload`);
      const stored = await existing.Body!.transformToByteArray();
      if (!sameBytes(stored, content)) throw conflict(validKey);
    },
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: assertKey(key) }),
        );
        return true;
      } catch (error) {
        if (absent(error)) return false;
        throw error;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      const pages = paginateListObjectsV2(
        { client, pageSize: LIST_PAGE_KEYS },
        { Bucket: bucket, Prefix: prefix },
      );
      for await (const page of pages) {
        for (const object of page.Contents ?? []) keys.push(object.Key!);
      }
      return keys.sort();
    },
    async remove(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: assertKey(key) }),
      );
    },
    async reach() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        throw unreachable(`${endpoint}/${bucket}`, error);
      }
    },
  };
}

interface S3Configuration {
  bucket: string;
  endpoint: string;
  region: string;
}

function s3Configuration(options: S3BlobStoreOptions): S3Configuration {
  let parsed: URL;
  try {
    parsed = new URL(options.endpoint);
  } catch {
    throw new Error("VITROFLOW_BLOB_ENDPOINT is not a URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported blob store endpoint scheme: ${parsed.protocol}//`,
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  ) {
    throw new Error("VITROFLOW_BLOB_ENDPOINT must name only an HTTP(S) origin");
  }
  if (!options.bucket || options.bucket.includes("/")) {
    throw new Error("VITROFLOW_BLOB_BUCKET must name exactly one bucket");
  }
  return {
    bucket: options.bucket,
    endpoint: parsed.origin,
    region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
  };
}

/** The bytes stored under `key`; every reader requires them to be there. */
export async function requireBlob(key: string): Promise<Uint8Array> {
  const bytes = await blobs().read(key);
  if (!bytes) throw new Error(`Missing blob: ${key}`);
  return bytes;
}

/** Optional immutable bytes, for readers that can prepare a missing asset. */
export function readBlob(key: string): Promise<Uint8Array | null> {
  return blobs().read(key);
}

/** A blob as a stream and its length, so a response never buffers it. */
export function openBlob(key: string): Promise<OpenBlob | null> {
  return blobs().open(key);
}

export function blobExists(key: string): Promise<boolean> {
  return blobs().exists(key);
}

export function putImmutableBlob(
  key: string,
  contents: Uint8Array | string,
): Promise<void> {
  return blobs().putImmutable(key, contents);
}

/** Every key under a prefix, in lexicographic order. */
export function listBlobs(prefix: string): Promise<string[]> {
  return blobs().list(prefix);
}

export function removeBlob(key: string): Promise<void> {
  return blobs().remove(key);
}
