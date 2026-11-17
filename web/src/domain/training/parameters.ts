import { z } from "zod";

const OPTIMIZERS = [
  "auto",
  "SGD",
  "Adam",
  "AdamW",
  "NAdam",
  "RAdam",
  "RMSProp",
] as const;

/** A side, in pixels, the detector's strides divide. */
const sideSchema = z
  .number()
  .int()
  .min(320)
  .max(3072)
  .multipleOf(32, "Image and tile sizes must be multiples of 32");

/**
 * The training arguments a run fixes. Every run records the full set, so a
 * version's training is reproducible from its manifest alone.
 */
export const trainingParametersSchema = z.strictObject({
  epochs: z.number().int().min(1).max(300),
  patience: z.number().int().min(0).max(300),
  batch: z.number().int().min(1).max(64),
  // Omission delegates accumulation to the recipe's pinned runtime.
  nbs: z.number().int().min(1).max(1024).optional(),
  // The resolution a frame is read at: the pixels along its longer side.
  imgsz: sideSchema,
  // The side of the square tiles a frame is read through. A frame is read
  // whole when the recipe states none, or one no smaller than `imgsz`.
  tile: sideSchema.optional(),
  optimizer: z.enum(OPTIMIZERS),
  lr0: z.number().min(0.00001).max(0.1),
  warmup_epochs: z.number().min(0).max(10),
  mosaic: z.number().min(0).max(1),
  mixup: z.number().min(0).max(1),
  copy_paste: z.number().min(0).max(1),
  max_det: z.number().int().min(1).max(10000),
  seed: z.number().int().min(0),
  deterministic: z.boolean(),
  scale: z.number().min(0).max(1).optional(),
  degrees: z.number().min(0).max(180).optional(),
  flipud: z.number().min(0).max(1).optional(),
  fliplr: z.number().min(0).max(1).optional(),
  translate: z.number().min(0).max(1).optional(),
  hsv_h: z.number().min(0).max(1).optional(),
  hsv_s: z.number().min(0).max(1).optional(),
  hsv_v: z.number().min(0).max(1).optional(),
});

export type TrainingParameters = z.infer<typeof trainingParametersSchema>;

/** The parameters a run may change from the recipe; the rest stay as recorded. */
export const trainingOverridesSchema = trainingParametersSchema
  .pick({
    epochs: true,
    imgsz: true,
    tile: true,
    batch: true,
    patience: true,
    lr0: true,
    warmup_epochs: true,
    nbs: true,
  })
  .partial();

export type TrainingOverrides = z.infer<typeof trainingOverridesSchema>;

/**
 * The overrides that change `parameters`: one that sets a parameter to the
 * value it already has adjusts nothing.
 */
export function effectiveOverrides(
  overrides: TrainingOverrides,
  parameters: TrainingParameters,
): TrainingOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(
      ([key, value]) => value !== parameters[key as keyof TrainingOverrides],
    ),
  );
}
