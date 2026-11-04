import { expect, test } from "bun:test";
import sharp from "sharp";

import { blobExists, removeBlob } from "../infra/blobs/store";
import { imageBytes } from "../testing/images";
import { imagePreviewKey } from "./keys";
import { openImagePreview } from "./preview";
import { storeImage } from "./store";

async function bytesOf(blob: { stream: ReadableStream<Uint8Array> }) {
  return new Uint8Array(await new Response(blob.stream).arrayBuffer());
}

test("an image is stored with a preview that holds its whole frame within the preview edge", async () => {
  const source = await sharp({
    create: { width: 3000, height: 1500, channels: 3, background: "#789" },
  })
    .png()
    .toBuffer();
  const { digest } = await storeImage(source);
  expect(await blobExists(imagePreviewKey(digest))).toBe(true);
  const preview = await openImagePreview(digest);
  const metadata = await sharp(await bytesOf(preview!)).metadata();
  expect(metadata.format).toBe("heif");
  expect([metadata.width, metadata.height]).toEqual([2048, 1024]);
});

test("an image smaller than the preview edge keeps its size", async () => {
  const { digest, width, height } = await storeImage(
    await imageBytes("small preview"),
  );
  const metadata = await sharp(
    await bytesOf((await openImagePreview(digest))!),
  ).metadata();
  expect([metadata.width, metadata.height]).toEqual([width, height]);
});

test("a missing preview is prepared when it is asked for", async () => {
  const { digest } = await storeImage(await imageBytes("preview on demand"));
  await removeBlob(imagePreviewKey(digest));
  expect(await openImagePreview(digest)).not.toBeNull();
  expect(await blobExists(imagePreviewKey(digest))).toBe(true);
});

test("an image that is not stored has no preview", async () => {
  expect(await openImagePreview("0".repeat(64))).toBeNull();
});
