import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { DatasetImportError } from "../../domain/datasets/errors";
import { readAnnotation } from "../annotations/documents";
import { ImageSourceError } from "../images/ingest";
import { imageBlobKey } from "../images/keys";
import { storeCanonicalImage } from "../images/store";
import {
  clearImageUnclear,
  markImageUnclear,
  readUnclearImages,
} from "../images/unclear";
import { requireBlob } from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import {
  imageBytes,
  imageDigest,
  observeTextsIntoDataset,
  reviewedDataset,
  storeTexts,
} from "../testing/fixtures";
import { handleCanonicalImageUpload } from "../transport/http/image-upload";
import { readDatasetByName } from "./memberships";
import { listImageRecords } from "./records";
import { importDataset, readDatasetManifest } from "./transfer";

async function canonicalBytes(content: string) {
  return requireBlob(imageBlobKey((await storeTexts([content]))[0]!));
}

describe("canonical images entering by digest", () => {
  test("are stored untouched under the digest they hash to", async () => {
    const bytes = await canonicalBytes("transfer-bytes");
    const digest = contentDigest(bytes);
    const stored = await storeCanonicalImage(digest, bytes);
    expect(stored.digest).toBe(digest);
    expect(await requireBlob(imageBlobKey(digest))).toEqual(bytes);
    expect(await storeCanonicalImage(digest, bytes)).toEqual(stored);
  });

  test("are refused when the bytes disagree with the digest or the encoding", async () => {
    const bytes = await canonicalBytes("transfer-mismatch");
    await expect(storeCanonicalImage("0".repeat(64), bytes)).rejects.toThrow(
      ImageSourceError,
    );
    const png = await imageBytes("transfer-png");
    await expect(storeCanonicalImage(contentDigest(png), png)).rejects.toThrow(
      /not a canonical image/,
    );
    const other = await sharp(png).webp().toBuffer();
    await expect(
      storeCanonicalImage(contentDigest(other), new Uint8Array(other)),
    ).rejects.toThrow(/not a canonical image/);
    const transparent = await sharp(Buffer.from([255, 0, 0, 0]), {
      raw: { width: 1, height: 1, channels: 4 },
    })
      .avif()
      .toBuffer();
    await expect(
      storeCanonicalImage(
        contentDigest(transparent),
        new Uint8Array(transparent),
      ),
    ).rejects.toThrow(/not a canonical image/);
  });

  test("answer the transfer route with the digest or the refusal", async () => {
    const bytes = await canonicalBytes("transfer-route");
    const digest = contentDigest(bytes);
    const put = (target: string, body: Uint8Array) =>
      handleCanonicalImageUpload(
        target,
        new Request(`http://workbench/api/transfer/images/${target}`, {
          method: "PUT",
          body: Buffer.from(body),
          headers: { "content-length": String(body.byteLength) },
        }),
      );
    const accepted = await put(digest, bytes);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ digest });
    expect((await put("f".repeat(64), bytes)).status).toBe(400);
    expect((await put("nonsense", bytes)).status).toBe(400);
  });
});

describe("dataset transfer", () => {
  test("a manifest imports as a new dataset with its reviews", async () => {
    const seeded = await reviewedDataset("transfer-source", ["ts-a", "ts-b"]);
    const manifest = await readDatasetManifest("transfer-source");
    if (!manifest) throw new Error("no manifest");
    expect(manifest.images).toHaveLength(2);
    expect(manifest.images.every((image) => image.annotation)).toBe(true);

    const other = await observeTextsIntoDataset("transfer-fresh", ["ts-c"]);
    const [otherRecord] = await listImageRecords(other.dataset.id);
    if (!otherRecord) throw new Error("no fresh image");
    const fresh = {
      ...manifest,
      dataset: "transfer-copy",
      images: manifest.images
        .map((image, index) => ({
          ...image,
          digest: other.digests[0]!,
          width: otherRecord.image.width,
          height: otherRecord.image.height,
          bytes: otherRecord.image.bytes,
          annotation: image.annotation && {
            ...image.annotation,
            image: {
              digest: other.digests[0]!,
              width: otherRecord.image.width,
              height: otherRecord.image.height,
            },
          },
          detection: null,
          split: index === 0 ? ("val" as const) : null,
        }))
        .slice(0, 1),
    };
    const created = await importDataset(fresh);
    expect(created).toEqual({
      id: expect.any(String),
      name: "transfer-copy",
      modelId: seeded.version.modelId,
    });
    expect(await readDatasetByName("transfer-copy")).toEqual(created);
    const [record] = await listImageRecords(created.id);
    expect(record?.image.split).toBe("val");
    expect(record?.image.filename).toBe(fresh.images[0]!.filename);
    expect(record?.annotation).toEqual(fresh.images[0]!.annotation!);
    expect(
      await readAnnotation({
        digest: other.digests[0]!,
        modelId: created.modelId,
      }),
    ).toEqual(fresh.images[0]!.annotation!);

    const again = await readDatasetManifest("transfer-copy");
    expect(again?.images[0]?.annotation).toEqual(fresh.images[0]!.annotation!);
  });

  test("a manifest says which photographs are unclear, and an import never clears a mark made here", async () => {
    const source = await observeTextsIntoDataset("transfer-unclear-source", [
      "tu-fogged",
      "tu-clear",
      "tu-local",
    ]);
    const [fogged, clear, local] = source.digests;
    await markImageUnclear({ digest: fogged! });
    const manifest = await readDatasetManifest("transfer-unclear-source");
    if (!manifest) throw new Error("no manifest");
    const said = new Map(
      manifest.images.map((image) => [image.digest, image.unclear]),
    );
    expect([fogged, clear, local].map((digest) => said.get(digest!))).toEqual([
      true,
      false,
      false,
    ]);

    // As another workbench would hold them: the first unmarked, the last
    // already marked by someone there.
    await clearImageUnclear({ digest: fogged! });
    await markImageUnclear({ digest: local! });
    await importDataset({ ...manifest, dataset: "transfer-unclear-copy" });
    expect(await readUnclearImages([fogged!, clear!, local!])).toEqual(
      new Set([fogged!, local!]),
    );
  });

  test("a manifest the workbench cannot hold changes nothing", async () => {
    await reviewedDataset("transfer-held", ["th-a"]);
    const manifest = await readDatasetManifest("transfer-held");
    if (!manifest) throw new Error("no manifest");
    const attempt = (change: Partial<typeof manifest>) =>
      importDataset({ ...manifest, ...change });

    await expect(attempt({})).rejects.toThrow(/already exists/);
    await expect(attempt({ dataset: "transfer-held-2" })).rejects.toThrow(
      /already reviewed/,
    );
    await expect(
      attempt({
        dataset: "transfer-held-2",
        model: { id: "transfer-nowhere", classes: manifest.model.classes },
      }),
    ).rejects.toThrow(/Unknown model/);
    await expect(
      attempt({
        dataset: "transfer-held-2",
        model: { id: manifest.model.id, classes: ["seed", "mould"] },
        images: [],
      }),
    ).rejects.toThrow(/has classes/);
    const unreviewed = manifest.images.map((image) => ({
      ...image,
      annotation: null,
      detection: null,
    }));
    await expect(
      attempt({
        dataset: "transfer-held-2",
        images: unreviewed.map((image) => ({
          ...image,
          digest: "e".repeat(64),
        })),
      }),
    ).rejects.toThrow(/not stored/);
    await expect(
      attempt({
        dataset: "transfer-held-2",
        images: unreviewed.map((image) => ({
          ...image,
          width: image.width + 1,
        })),
      }),
    ).rejects.toThrow(/other metadata/);
    await expect(
      attempt({
        dataset: "transfer-held-2",
        images: unreviewed.map((image) => ({
          ...image,
          bytes: image.bytes + 1,
        })),
      }),
    ).rejects.toThrow(/other metadata/);
    await expect(
      attempt({ dataset: "transfer-held-2" }),
    ).rejects.toBeInstanceOf(DatasetImportError);
    expect(await readDatasetByName("transfer-held-2")).toBeNull();

    expect(
      await importDataset({
        ...manifest,
        dataset: "transfer-held-2",
        images: unreviewed,
      }),
    ).toEqual({
      id: expect.any(String),
      name: "transfer-held-2",
      modelId: manifest.model.id,
    });
    expect(await imageDigest("th-a")).toBe(unreviewed[0]!.digest);
  });

  test("concurrent imports create the dataset exactly once", async () => {
    await reviewedDataset("transfer-race-source", ["race"]);
    const source = await readDatasetManifest("transfer-race-source");
    if (!source) throw new Error("no manifest");
    const manifest = {
      ...source,
      dataset: "transfer-race",
      images: source.images.map((image) => ({
        ...image,
        detection: null,
        annotation: null,
      })),
    };

    const results = await Promise.allSettled([
      importDataset(manifest),
      importDataset(manifest),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DatasetImportError);
    expect(await readDatasetByName("transfer-race")).toEqual({
      id: expect.any(String),
      name: "transfer-race",
      modelId: source.model.id,
    });
  });
});
