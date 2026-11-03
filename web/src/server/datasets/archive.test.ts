import { expect, test } from "bun:test";

import { DATASET_ARCHIVE_LIMITS } from "../../domain/datasets/archive-format";
import { datasetManifestSchema } from "../../domain/datasets/manifest";
import { readStoredZip } from "../../lib/archive/zip";
import { imageBlobKey } from "../images/keys";
import { requireBlob } from "../infra/blobs/store";
import { reviewedDataset } from "../testing/fixtures";
import { datasetArchive } from "./archive";

test("an archive holds the manifest first and then every image by digest", async () => {
  const seeded = await reviewedDataset("archive-set", ["ar-a", "ar-b"]);
  const archived = await datasetArchive(seeded.dataset.id);
  if (!archived) throw new Error("no archive");
  expect(archived.name).toBe("archive-set");
  const entries = [];
  for await (const entry of readStoredZip(
    archived.archive,
    DATASET_ARCHIVE_LIMITS,
  )) {
    entries.push(entry);
  }

  expect(entries[0]?.name).toBe("datasets/archive-set.json");
  const manifest = datasetManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(entries[0]!.bytes)),
  );
  expect(manifest.images.map((image) => image.digest)).toEqual(seeded.digests);
  expect(entries.slice(1).map((entry) => entry.name)).toEqual(
    seeded.digests.map((digest) => `blobs/${digest.slice(0, 2)}/${digest}`),
  );
  for (const [index, digest] of seeded.digests.entries()) {
    expect(entries[index + 1]!.bytes).toEqual(
      new Uint8Array(await requireBlob(imageBlobKey(digest))),
    );
  }
  expect(await datasetArchive(crypto.randomUUID())).toBeNull();
});
