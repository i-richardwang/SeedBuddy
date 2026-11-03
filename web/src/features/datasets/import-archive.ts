import { z } from "zod";

import {
  DATASET_ARCHIVE_LIMITS,
  entryKind,
} from "../../domain/datasets/archive-format";
import {
  type DatasetManifest,
  datasetManifestSchema,
  encodeDatasetManifest,
  MAX_DATASET_MANIFEST_BYTES,
} from "../../domain/datasets/manifest";
import { type Dataset, datasetSchema } from "../../domain/datasets/schema";
import { imageDigestSchema } from "../../domain/images/schema";
import { readStoredZip } from "../../lib/archive/zip";
import { parseHttpJson } from "../../lib/http/json";
import { m } from "../../paraglide/messages";

/** Why an archive cannot be imported as it stands. */
export class DatasetArchiveError extends Error {}

export type ImportProgress =
  | { phase: "reading" }
  | {
      phase: "storing";
      manifest: DatasetManifest;
      /** Images the workbench has acknowledged so far. */
      stored: number;
    };

const storedImageSchema = z.strictObject({ digest: imageDigestSchema });
const importedDatasetSchema = z.strictObject({ dataset: datasetSchema });
const errorResponseSchema = z.strictObject({ error: z.string().min(1) });

async function refusal(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

async function responseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return parseHttpJson(await response.text(), response.status, schema);
  } catch (error) {
    throw new DatasetArchiveError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Imports the archive into the workbench serving the page: every image it
 * carries goes up first, one request each, and the manifest last, which the
 * workbench applies as a whole. Nothing is sent when the dataset already
 * exists, and an archive the workbench refuses never creates the dataset.
 */
export async function importDatasetArchive(
  archive: Blob,
  onProgress: (progress: ImportProgress) => void,
): Promise<Dataset> {
  onProgress({ phase: "reading" });
  let manifest: DatasetManifest | null = null;
  const expected = new Map<string, number>();
  const stored = new Set<string>();
  for await (const entry of readStoredZip(
    archive.stream(),
    DATASET_ARCHIVE_LIMITS,
  )) {
    const kind = entryKind(entry.name);
    if (!kind) {
      throw new DatasetArchiveError(
        m.dataset_archive_unexpected_entry({ entry: entry.name }),
      );
    }
    if (kind.kind === "manifest") {
      if (manifest) {
        throw new DatasetArchiveError(m.dataset_archive_multiple_datasets());
      }
      if (entry.bytes.byteLength > MAX_DATASET_MANIFEST_BYTES) {
        throw new DatasetArchiveError(m.dataset_archive_manifest_too_large());
      }
      let document: unknown;
      try {
        document = JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown;
      } catch {
        throw new DatasetArchiveError(m.dataset_archive_manifest_not_json());
      }
      const parsed = datasetManifestSchema.safeParse(document);
      if (!parsed.success || parsed.data.dataset !== kind.dataset) {
        throw new DatasetArchiveError(m.dataset_archive_manifest_invalid());
      }
      manifest = parsed.data;
      for (const image of manifest.images) {
        expected.set(image.digest, image.bytes);
      }
      const existing = await fetch(
        `/api/transfer/datasets/${encodeURIComponent(manifest.dataset)}`,
        { redirect: "error" },
      );
      if (existing.status === 200) {
        throw new DatasetArchiveError(
          m.dataset_archive_exists({ dataset: manifest.dataset }),
        );
      }
      if (existing.status !== 404) {
        throw new DatasetArchiveError(
          await refusal(existing, m.dataset_archive_destination_unchecked()),
        );
      }
      onProgress({ phase: "storing", manifest, stored: 0 });
      continue;
    }
    if (!manifest) {
      throw new DatasetArchiveError(m.dataset_archive_manifest_first());
    }
    const expectedBytes = expected.get(kind.digest);
    if (expectedBytes === undefined) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_unnamed({ digest: kind.digest }),
      );
    }
    if (stored.has(kind.digest)) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_duplicate({ digest: kind.digest }),
      );
    }
    if (entry.bytes.byteLength !== expectedBytes) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_size({ digest: kind.digest }),
      );
    }
    const response = await fetch(`/api/transfer/images/${kind.digest}`, {
      method: "PUT",
      headers: { "content-type": "image/avif" },
      body: entry.bytes,
      redirect: "error",
    });
    const accepted = await responseJson(response, storedImageSchema);
    if (accepted.digest !== kind.digest) {
      throw new DatasetArchiveError(m.dataset_archive_image_mismatch());
    }
    stored.add(kind.digest);
    onProgress({ phase: "storing", manifest, stored: stored.size });
  }
  if (!manifest) throw new DatasetArchiveError(m.dataset_archive_no_dataset());
  const missing = [...expected.keys()].filter((digest) => !stored.has(digest));
  if (missing.length > 0) {
    throw new DatasetArchiveError(
      m.dataset_archive_images_missing({ count: missing.length }),
    );
  }
  const response = await fetch(
    `/api/transfer/datasets/${encodeURIComponent(manifest.dataset)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: encodeDatasetManifest(manifest),
      redirect: "error",
    },
  );
  return (await responseJson(response, importedDatasetSchema)).dataset;
}
