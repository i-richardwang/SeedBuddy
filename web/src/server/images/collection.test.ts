import { describe, expect, test } from "bun:test";

import { blobExists, listBlobs, putImmutableBlob } from "../infra/blobs/store";
import { imageBytes, observeImages } from "../testing/fixtures";
import { collectImages } from "./collection";
import { canonicalize } from "./ingest";
import { imageBlobKey, imagePreviewKey, imageRegionsPrefix } from "./keys";
import { readImageRegion } from "./regions";
import { storeImage } from "./store";

describe("collection", () => {
  /** A moment past the period an unclaimed image is kept for. */
  const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

  test("keeps unclaimed bytes while an observation is still being submitted", async () => {
    const { digest } = await storeImage(await imageBytes("waiting"));
    expect(await collectImages()).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });

  test("collects images no observation claimed", async () => {
    const image = await storeImage(await imageBytes("abandoned"));
    const { digest } = image;
    await readImageRegion(
      image,
      { coreSize: 512, halo: 32, displayScale: 1 },
      "tile-000-000",
    );
    expect(
      (await listBlobs(imageRegionsPrefix(digest))).length,
    ).toBeGreaterThan(0);
    expect(await collectImages(later())).toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(false);
    expect(await blobExists(imagePreviewKey(digest))).toBe(false);
    expect(await listBlobs(imageRegionsPrefix(digest))).toEqual([]);
  });

  test("an observation keeps its images", async () => {
    const { digests } = await observeImages("kept images", ["kept"]);
    const frame = await canonicalize(await imageBytes("kept"));
    const evidence = await readImageRegion(
      frame,
      { coreSize: 512, halo: 32, displayScale: 1 },
      "tile-000-000",
    );
    expect(await collectImages(later())).not.toContain(digests[0]);
    expect(await blobExists(imageBlobKey(digests[0]!))).toBe(true);
    expect(await blobExists(evidence.key)).toBe(true);
  });

  test("collects an immutable object whose Image transaction never committed", async () => {
    const orphan = await canonicalize(await imageBytes("orphan"));
    await putImmutableBlob(imageBlobKey(orphan.digest), orphan.bytes);
    const evidence = await readImageRegion(
      orphan,
      { coreSize: 512, halo: 32, displayScale: 1 },
      "tile-000-000",
    );

    expect(await collectImages()).toContain(orphan.digest);
    expect(await blobExists(imageBlobKey(orphan.digest))).toBe(false);
    expect(await blobExists(evidence.key)).toBe(false);
  });
});
