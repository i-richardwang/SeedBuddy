import {
  MAX_UPLOADED_IMAGE_PIXELS,
  reducedImageSize,
} from "../../domain/images/canonical";
import { encodedImageSize, type PixelSize } from "../../lib/image/size";
import { m } from "../../paraglide/messages";

/** Enough of a file to reach its size declaration past a camera's metadata. */
const HEADER_BYTES = 512 * 1024;

/** Near enough to the source that the reduction, not the encoding, is what changes. */
const REDUCED_QUALITY = 0.95;

/**
 * The photograph drawn at `target` as a JPEG, on the white the store lays
 * under a transparent source. A canvas the browser could not back takes no
 * paint, which the corner tells before anything blank is encoded.
 */
async function reduce(file: File, target: PixelSize): Promise<Blob> {
  const source = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas to draw the photograph on");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, target.width, target.height);
    if (context.getImageData(0, 0, 1, 1).data[3] !== 255) {
      throw new Error("The canvas is larger than the browser can paint");
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, target.width, target.height);
    return await canvas.convertToBlob({
      type: "image/jpeg",
      quality: REDUCED_QUALITY,
    });
  } finally {
    source.close();
  }
}

/**
 * The photograph as it is uploaded: itself, or a JPEG of it reduced in the
 * browser when its header declares more pixels than a photograph is
 * uploaded with. The reduced photograph stands upright as its camera
 * recorded, in sRGB, under the file's name. A file whose header declares no
 * size, such as a TIFF, goes up as it is and the server answers for it; one
 * that needs reducing and cannot be reduced here is refused.
 */
export async function reducedForUpload(file: File): Promise<File> {
  const header = new Uint8Array(
    await file.slice(0, HEADER_BYTES).arrayBuffer(),
  );
  const declared = encodedImageSize(header);
  const target = declared && reducedImageSize(declared);
  if (!target) return file;
  const reduced = await reduce(file, target).catch(() => {
    throw new Error(
      m.image_not_reduced({
        megapixels: MAX_UPLOADED_IMAGE_PIXELS / 1_000_000,
      }),
    );
  });
  return new File([reduced], file.name, {
    type: reduced.type,
    lastModified: file.lastModified,
  });
}
