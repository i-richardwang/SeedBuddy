import { z } from "zod";
export const imageRectangleSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export interface ImageFrame {
  digest: string;
  width: number;
  height: number;
}
export interface ImageRegionLayout {
  coreSize: number;
  halo: number;
  displayScale: number;
}
export type ImageRectangle = z.infer<typeof imageRectangleSchema>;
export interface ImageRegion {
  id: string;
  core: ImageRectangle;
  patch: ImageRectangle;
}
