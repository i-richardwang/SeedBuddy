import type { PixelSize } from "../../lib/image/size";

/** Source files accepted at the image boundary. */
export const SOURCE_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
] as const;

/** Decoder format names corresponding to the accepted source extensions. */
export const SOURCE_IMAGE_FORMATS = ["jpeg", "png", "tiff"] as const;

/** Bounds the decoded memory of one source while covering 26 MP images. */
export const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;

/**
 * The most pixels a photograph is uploaded with; a larger one is reduced to
 * this many first. It covers the 24 MP and 26 MP cameras the experiments
 * are photographed with, so their photographs go up as taken and keep the
 * bytes, and the digest, they have always had.
 */
export const MAX_UPLOADED_IMAGE_PIXELS = 26_000_000;

/**
 * The size a photograph is reduced to before upload, keeping its shape, or
 * null when it is uploaded as it is.
 */
export function reducedImageSize({
  width,
  height,
}: PixelSize): PixelSize | null {
  const pixels = width * height;
  if (pixels <= MAX_UPLOADED_IMAGE_PIXELS) return null;
  const scale = Math.sqrt(MAX_UPLOADED_IMAGE_PIXELS / pixels);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Bounds one uploaded source or transferred canonical image. */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** Every stored image is an opaque, oriented sRGB AVIF. */
export const CANONICAL_IMAGE_MEDIA_TYPE = "image/avif";

/** Why a browser file cannot enter the image boundary. */
export function sourceImageFileError(file: {
  name: string;
  size: number;
}): "unsupported" | "empty" | "too_large" | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!SOURCE_IMAGE_EXTENSIONS.some((accepted) => accepted === extension)) {
    return "unsupported";
  }
  if (file.size === 0) return "empty";
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return null;
}
