import fs from "node:fs";
import path from "node:path";

import { expect, test } from "bun:test";

import { DatasetManifestTooLargeError } from "./errors";
import {
  datasetManifestSchema,
  encodeDatasetManifest,
  MAX_DATASET_MANIFEST_BYTES,
} from "./manifest";

const CONTRACT_FIXTURE = path.resolve(
  import.meta.dir,
  "../../../../tests/fixtures/contracts/dataset-manifest.json",
);

function contractFixture(): unknown {
  return JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, "utf-8"));
}

test("shared dataset manifest contract", () => {
  const dataset = datasetManifestSchema.parse(contractFixture());

  expect(dataset.dataset).toBe("seed-set");
  expect(dataset.images[0]?.annotation?.instances).toHaveLength(1);
});

test("manifest documents must describe their enclosing image", () => {
  const dataset = contractFixture() as {
    images: [{ annotation: { image: { digest: string } } }];
  };
  dataset.images[0].annotation.image.digest = "d".repeat(64);

  expect(datasetManifestSchema.safeParse(dataset).success).toBe(false);
});

test("a manifest names each image once", () => {
  const dataset = contractFixture() as {
    images: unknown[];
  };
  dataset.images.push(dataset.images[0]);

  expect(datasetManifestSchema.safeParse(dataset).success).toBe(false);
});

test("manifest encoding is canonical and bounded", () => {
  const dataset = datasetManifestSchema.parse(contractFixture());
  const encoded = encodeDatasetManifest(dataset);

  expect(new TextDecoder().decode(encoded)).toBe(
    `${JSON.stringify(dataset)}\n`,
  );

  dataset.images[0]!.filename = "x".repeat(MAX_DATASET_MANIFEST_BYTES);
  expect(() => encodeDatasetManifest(dataset)).toThrow(
    DatasetManifestTooLargeError,
  );
});
