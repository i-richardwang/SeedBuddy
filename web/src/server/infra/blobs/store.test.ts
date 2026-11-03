import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  type BlobStore,
  createMemoryBlobStore,
  createS3BlobStore,
  ImmutableBlobConflictError,
} from "./store";

async function contents(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function assertBlobStoreContract(store: BlobStore): Promise<void> {
  const prefix = `contracts/${randomUUID()}`;
  const first = `${prefix}/first`;
  const second = `${prefix}/second`;
  try {
    expect(await store.read(first)).toBeNull();
    expect(await store.open(first)).toBeNull();

    await store.putImmutable(first, "alpha");
    await store.putImmutable(first, "alpha");
    await expect(store.putImmutable(first, "different")).rejects.toBeInstanceOf(
      ImmutableBlobConflictError,
    );
    const stored = await store.read(first);
    if (!stored) throw new Error("immutable blob disappeared");
    expect(new TextDecoder().decode(stored)).toBe("alpha");
    stored[0] = 0;
    expect(await store.read(first)).toEqual(new TextEncoder().encode("alpha"));

    await store.putImmutable(second, "beta");
    expect(await store.list(prefix)).toEqual([first, second]);
    const opened = await store.open(second);
    expect(opened?.size).toBe(4);
    expect(opened && (await contents(opened.stream))).toBe("beta");

    await store.remove(first);
    expect(await store.exists(first)).toBeFalse();
    expect(await store.list(prefix)).toEqual([second]);
    await expect(store.putImmutable("../invalid", "x")).rejects.toThrow(
      /Invalid blob key/,
    );
  } finally {
    await Promise.all([store.remove(first), store.remove(second)]);
  }
}

test("memory blob store obeys the immutable object contract", async () => {
  await assertBlobStoreContract(createMemoryBlobStore());
});

const s3Endpoint = process.env.VITROFLOW_TEST_S3_ENDPOINT;
const s3Bucket = process.env.VITROFLOW_TEST_S3_BUCKET;
if (
  process.env.VITROFLOW_REQUIRE_S3_CONTRACT === "1" &&
  (!s3Endpoint || !s3Bucket)
) {
  throw new Error(
    "The required S3 contract needs VITROFLOW_TEST_S3_ENDPOINT and VITROFLOW_TEST_S3_BUCKET",
  );
}
const s3Test = s3Endpoint && s3Bucket ? test : test.skip;

s3Test("S3 blob store obeys the immutable object contract", async () => {
  const store = createS3BlobStore({
    endpoint: s3Endpoint!,
    bucket: s3Bucket!,
  });
  await store.reach();
  await assertBlobStoreContract(store);
});
