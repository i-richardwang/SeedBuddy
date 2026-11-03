import sharp from "sharp";

import { MAX_SOURCE_IMAGE_PIXELS } from "../../domain/images/canonical";
import type { ImageCoverage } from "../../domain/images/coverage";
import type {
  ImageFrame,
  ImageRectangle,
  ImageRegionLayout,
} from "../../domain/images/geometry";
import { imageOverview, imageRegions } from "../../domain/images/regions";
import { createSingleFlight } from "../../lib/async/work";
import { ByteCache } from "../../lib/cache/bytes";
import { canonicalJson } from "../../lib/json/canonical";
import {
  type BlobStore,
  putImmutableBlob,
  readBlob,
} from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import { imageBlobKey, imageRegionsPrefix } from "./keys";
import { processImage } from "./processing";

export interface ImageRegionEvidence {
  key: string;
  clean: Buffer;
}
/** Persistent image evidence shares one bounded decode per selected region plan. */
export function createImageEvidence(
  store: Pick<BlobStore, "read" | "putImmutable">,
) {
  const cache = new ByteCache<Buffer>(32 * 1024 * 1024);
  const preparingRegions = createSingleFlight<void>();
  const reading = createSingleFlight<Buffer | null>();

  async function read(key: string): Promise<Buffer | null> {
    const cached = cache.get(key);
    if (cached) return cached;
    return reading(key, async () => {
      const bytes = await store.read(key);
      if (!bytes) return null;
      const buffer = Buffer.from(bytes);
      cache.set(key, buffer);
      return buffer;
    });
  }
  async function write(key: string, bytes: Buffer): Promise<void> {
    await store.putImmutable(key, bytes);
    cache.set(key, bytes);
  }
  function prefix(image: ImageFrame, layout: ImageRegionLayout) {
    const { coreSize, halo, displayScale } = layout;
    const recipe = contentDigest(
      canonicalJson({
        version: 1,
        coreSize,
        halo,
        displayScale,
        renderer: sharp.versions,
      }),
    );
    return `${imageRegionsPrefix(image.digest)}${recipe}/`;
  }
  async function decode(image: ImageFrame) {
    const source = await store.read(imageBlobKey(image.digest));
    if (!source) throw new Error(`Missing image: ${image.digest}`);
    const { data, info } = await sharp(source, {
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
    })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      info.width !== image.width ||
      info.height !== image.height ||
      info.channels !== 3
    )
      throw new Error("Image pixels do not match the canonical frame");
    return () =>
      sharp(data, {
        raw: { width: info.width, height: info.height, channels: 3 },
      });
  }
  type Pixels = Awaited<ReturnType<typeof decode>>;
  function evidencePlan(
    image: ImageFrame,
    layout: ImageRegionLayout,
    scope: readonly ImageRectangle[] | null,
    coverage: ImageCoverage | null,
  ) {
    const directory = prefix(image, layout);
    const regions = imageRegions(image, layout, scope, coverage);
    const receipt = Buffer.from(canonicalJson(regions.map(({ id }) => id)));
    return {
      image,
      layout,
      regions,
      directory,
      receipt,
      receiptKey: `${directory}plans/${contentDigest(receipt)}.json`,
    };
  }
  type EvidencePlan = ReturnType<typeof evidencePlan>;

  async function prepare(
    plan: EvidencePlan,
    loadPixels: () => Promise<Pixels>,
  ) {
    if (await read(plan.receiptKey)) return;
    let decoded: Pixels | undefined;
    const sourcePixels = async () => (decoded ??= await loadPixels());
    const { image, layout, directory, regions } = plan;
    const overviewKey = `${directory}overview.png`;
    const overview = imageOverview(image);
    if (!(await read(overviewKey))) {
      const pixels = await sourcePixels();
      await write(
        overviewKey,
        await pixels().resize(overview.width, overview.height).png().toBuffer(),
      );
    }
    for (const { id, patch } of regions) {
      const key = `${directory}${id}.png`;
      if (await read(key)) continue;
      const pixels = await sourcePixels();
      const clean = await pixels()
        .extract({
          left: patch.x,
          top: patch.y,
          width: patch.width,
          height: patch.height,
        })
        .resize(
          patch.width * layout.displayScale,
          patch.height * layout.displayScale,
          { kernel: "nearest" },
        )
        .png()
        .toBuffer();
      await write(key, clean);
    }
    await write(plan.receiptKey, plan.receipt);
  }

  async function evidence(
    image: ImageFrame,
    layout: ImageRegionLayout,
    scope: readonly ImageRectangle[] | null,
    coverage: ImageCoverage | null,
    regionId: string | null,
  ): Promise<{ key: string; bytes: Buffer }> {
    const plan = evidencePlan(image, layout, scope, coverage);
    if (
      regionId !== null &&
      !plan.regions.some((region) => region.id === regionId)
    )
      throw new Error("Image region does not exist");
    const key = `${plan.directory}${regionId ?? "overview"}.png`;
    const existing = await read(key);
    if (existing) return { key, bytes: existing };
    const flight = plan.receiptKey;
    await preparingRegions(flight, () =>
      processImage(async () => {
        if (await read(key)) return;
        await prepare(plan, () => decode(image));
      }),
    );
    const bytes = await read(key);
    if (!bytes) throw new Error("Prepared image region is missing");
    return { key, bytes };
  }

  return {
    async readRegion(
      image: ImageFrame,
      layout: ImageRegionLayout,
      regionId: string,
      scope: readonly ImageRectangle[] | null = null,
      coverage: ImageCoverage | null = null,
    ): Promise<ImageRegionEvidence> {
      const { key, bytes } = await evidence(
        image,
        layout,
        scope,
        coverage,
        regionId,
      );
      return { key, clean: bytes };
    },
    async readOverview(
      image: ImageFrame,
      layout: ImageRegionLayout,
      scope: readonly ImageRectangle[] | null = null,
      coverage: ImageCoverage | null = null,
    ) {
      const { bytes } = await evidence(image, layout, scope, coverage, null);
      return { ...imageOverview(image), bytes };
    },
  };
}

const evidence = createImageEvidence({
  read: readBlob,
  putImmutable: putImmutableBlob,
});
export const readImageRegion = evidence.readRegion;
export const readImageOverview = evidence.readOverview;
