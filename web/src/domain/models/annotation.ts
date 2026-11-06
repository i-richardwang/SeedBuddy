import { z } from "zod";

import { modelAreaSchema } from "./area";
import { classListSchema } from "./classes";

export const annotationRegionSchema = z.strictObject({
  coreSize: z.number().int().min(16).max(2048),
  halo: z.number().int().min(0).max(2048),
  displayScale: z.number().int().min(1).max(4),
});

export const DEFAULT_ANNOTATION_REGION = {
  coreSize: 512,
  halo: 32,
  displayScale: 1,
} satisfies z.infer<typeof annotationRegionSchema>;

export const SEED_ANNOTATION_CONFIG = {
  ...DEFAULT_ANNOTATION_REGION,
  area: "dish" as const,
  classes: ["ungerminated", "germinated"],
  rules: `Box every visible seed separately, germinated or not. A seed is germinated
once a radicle or shoot has visibly broken through its coat, and ungerminated
until then; mark a box uncertain when its state cannot be told. Enclose the seed
body together with any radicle or shoot that emerged from it. Seeds include opaque
brown/gold and pale yellow/translucent bodies with a coherent elongated outline;
enclose the complete visible body, including pale coat and tips, before
minimizing background. Distinguish seeds and their radicles and shoots from
fibers and glare. Inspect touching clusters for separate bodies at different
angles; their rectangles may overlap naturally. Do not force an expected count
or mechanically shrink, expand or pad boxes.`,
};

/** Complete visual task settings, shared by product assignments and standalone runs. */
export const annotationConfigSchema = annotationRegionSchema
  .extend({
    area: modelAreaSchema,
    classes: classListSchema,
    rules: z.string().trim().min(1),
  })
  .meta({ default: SEED_ANNOTATION_CONFIG });
