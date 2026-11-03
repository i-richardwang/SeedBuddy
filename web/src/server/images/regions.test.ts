import { expect, test } from "bun:test";
import sharp from "sharp";

import { dishCoverage } from "../../domain/images/coverage";
import { imageOverview, imageRegions } from "../../domain/images/regions";
import { createMemoryBlobStore } from "../infra/blobs/store";
import { canonicalize } from "./ingest";
import { imageBlobKey } from "./keys";
import { createImageEvidence } from "./regions";

async function fixture() {
  const width = 1250,
    height = 830;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = (i * 13 + Math.floor(i / (width * 3))) % 256;
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const image = await canonicalize(source);
  const store = createMemoryBlobStore();
  await store.putImmutable(imageBlobKey(image.digest), image.bytes);
  let sourceReads = 0;
  const reads: string[] = [];
  const tracked = {
    read: async (key: string) => {
      reads.push(key);
      if (key === imageBlobKey(image.digest)) sourceReads++;
      return store.read(key);
    },
    putImmutable: store.putImmutable,
  };
  return { image, store, tracked, reads, sourceReads: () => sourceReads };
}

// Pixel correctness, not an encoding-speed benchmark: allow CPU-only CI headroom.
test.each([1, 2, 4])(
  "prepared evidence preserves source-pipeline pixels at edges and halos at %ix scale",
  async (displayScale) => {
    const { image, tracked } = await fixture();
    const { readRegion: read, readOverview } = createImageEvidence(tracked);
    const layout = { coreSize: 512, halo: 32, displayScale };
    const overview = imageOverview(image);
    const preparedOverview = await readOverview(image, layout);
    const expectedOverview = await sharp(image.bytes)
      .resize(overview.width, overview.height)
      .raw()
      .toBuffer();
    expect(await sharp(preparedOverview.bytes).raw().toBuffer()).toEqual(
      expectedOverview,
    );
    for (const { id, patch } of imageRegions(image, layout)) {
      const evidence = await read(image, layout, id);
      const expected = await sharp(image.bytes)
        .extract({
          left: patch.x,
          top: patch.y,
          width: patch.width,
          height: patch.height,
        })
        .resize(patch.width * displayScale, patch.height * displayScale, {
          kernel: "nearest",
        })
        .raw()
        .toBuffer();
      expect(await sharp(evidence.clean).raw().toBuffer()).toEqual(expected);
    }
  },
  15_000,
);

test("concurrent regions prepare the source once and a new reader reuses persisted assets", async () => {
  const { image, tracked, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const regions = imageRegions(image, layout);
  const { readRegion: read } = createImageEvidence(tracked);
  const evidence = await Promise.all(
    regions.map(({ id }) => read(image, layout, id)),
  );
  expect(sourceReads()).toBe(1);
  const { readRegion: restarted } = createImageEvidence(tracked);
  expect((await restarted(image, layout, regions.at(-1)!.id)).clean).toEqual(
    evidence.at(-1)!.clean,
  );
  expect(sourceReads()).toBe(1);
  await restarted(image, { ...layout, halo: 48 }, regions[0]!.id);
  expect(sourceReads()).toBe(2);
});

test("partial preparation is reusable and failed work does not poison later requests", async () => {
  const { image, tracked, store, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  let fail = true;
  const { readRegion: read } = createImageEvidence({
    ...tracked,
    putImmutable: async (key, bytes) => {
      if (fail && key.endsWith("tile-000-001.png")) {
        fail = false;
        throw new Error("storage unavailable");
      }
      await tracked.putImmutable(key, bytes);
    },
  });
  await expect(read(image, layout, "tile-000-001")).rejects.toThrow(
    "storage unavailable",
  );
  expect(sourceReads()).toBe(1);
  const { readRegion: restarted } = createImageEvidence(tracked);
  await restarted(image, layout, "tile-000-000");
  expect(sourceReads()).toBe(1);
  await read(image, layout, "tile-000-001");
  expect(sourceReads()).toBe(2);
  await store.remove(imageBlobKey(image.digest));
  await createImageEvidence(tracked).readRegion(image, layout, "tile-001-002");
  expect(sourceReads()).toBe(2);
});

test("scoped preparation produces only needed regions and can be reused or expanded", async () => {
  const { image, store, tracked, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const scope = [{ x: 512, y: 0, width: 1, height: 1 }];
  const { readRegion: read } = createImageEvidence(tracked);
  const first = await read(image, layout, "tile-000-001", scope);
  expect((await store.list("image-regions/")).length).toBe(3);
  expect((await read(image, layout, "tile-000-001")).clean).toBe(first.clean);
  expect(sourceReads()).toBe(1);
  await expect(read(image, layout, "tile-000-000", scope)).rejects.toThrow(
    "does not exist",
  );
  const [second, third] = await Promise.all([
    read(image, layout, "tile-000-000", [{ x: 0, y: 0, width: 1, height: 1 }]),
    read(image, layout, "tile-001-002"),
  ]);
  expect(second.clean.byteLength).toBeGreaterThan(0);
  expect(third.clean.byteLength).toBeGreaterThan(0);
  expect(sourceReads()).toBe(3);
});

test("context and regional reads share preparation but fetch only their own persisted evidence", async () => {
  const { image, tracked, reads, sourceReads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const reader = createImageEvidence(tracked);
  const [overview, region] = await Promise.all([
    reader.readOverview(image, layout),
    reader.readRegion(image, layout, "tile-000-000"),
  ]);
  expect(sourceReads()).toBe(1);
  reads.length = 0;
  const restarted = createImageEvidence(tracked);
  expect(await restarted.readRegion(image, layout, "tile-000-000")).toEqual(
    region,
  );
  expect(reads).toEqual([region.key]);
  reads.length = 0;
  expect(await restarted.readOverview(image, layout)).toEqual(overview);
  expect(reads).toHaveLength(1);
  expect(reads[0]).toEndWith("/overview.png");
  expect(sourceReads()).toBe(1);
});

test("coverage selects evidence independently of analysis and preserves original patches", async () => {
  const { image, store, tracked, sourceReads, reads } = await fixture();
  const layout = { coreSize: 512, halo: 32, displayScale: 1 };
  const coverage = dishCoverage(image, {
    x: image.width / 2,
    y: image.height / 2,
    radius: image.height * 0.4,
  })!;
  const tasks = imageRegions(image, layout, null, coverage);
  expect(tasks).toHaveLength(4);
  const reader = createImageEvidence(tracked);
  for (const { id } of tasks)
    await reader.readRegion(image, layout, id, null, coverage);
  expect(sourceReads()).toBe(1);
  const keys = await store.list("image-regions/");
  expect(keys.filter((key) => key.endsWith(".png"))).toHaveLength(5);
  expect(keys.some((key) => key.endsWith("tile-000-002.png"))).toBe(false);
  expect(keys.some((key) => key.includes("/dish/"))).toBe(false);
  reads.length = 0;
  const restarted = createImageEvidence(tracked);
  await restarted.readRegion(
    image,
    layout,
    "tile-000-001",
    [{ x: 512, y: 0, width: 1, height: 1 }],
    coverage,
  );
  expect(sourceReads()).toBe(1);
  expect(reads).toHaveLength(1);
  await expect(
    restarted.readRegion(image, layout, "tile-000-002", null, coverage),
  ).rejects.toThrow("does not exist");
});
