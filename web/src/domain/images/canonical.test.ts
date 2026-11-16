import { describe, expect, test } from "bun:test";

import {
  MAX_IMAGE_BYTES,
  MAX_UPLOADED_IMAGE_PIXELS,
  reducedImageSize,
  sourceImageFileError,
} from "./canonical";

describe("source image admission", () => {
  test("accepts the formats the server canonicalizes", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.tif", "a.TIFF"]) {
      expect(sourceImageFileError({ name, size: 1 })).toBeNull();
    }
  });

  test("rejects unsupported, empty, and oversized sources", () => {
    expect(sourceImageFileError({ name: "a.avif", size: 1 })).toBe(
      "unsupported",
    );
    expect(sourceImageFileError({ name: "a.jpg", size: 0 })).toBe("empty");
    expect(
      sourceImageFileError({
        name: "a.jpg",
        size: MAX_IMAGE_BYTES + 1,
      }),
    ).toBe("too_large");
  });
});

describe("reduction before upload", () => {
  test("photographs of the cameras in use are uploaded as taken", () => {
    expect(reducedImageSize({ width: 6240, height: 4160 })).toBeNull();
    expect(reducedImageSize({ width: 4284, height: 5712 })).toBeNull();
  });

  test("a larger photograph is reduced to the most pixels uploaded, in its own shape", () => {
    const reduced = reducedImageSize({ width: 8064, height: 6048 })!;
    expect(reduced).toEqual({ width: 5887, height: 4415 });
    expect(reduced.width * reduced.height).toBeLessThanOrEqual(
      MAX_UPLOADED_IMAGE_PIXELS,
    );
    expect(reducedImageSize({ width: 6048, height: 8064 })).toEqual({
      width: 4415,
      height: 5887,
    });
  });
});
