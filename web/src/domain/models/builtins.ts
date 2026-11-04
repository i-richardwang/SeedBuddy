import { z } from "zod";

import traditionalManifest from "../../../../configs/traditional-v1.json";
import { sha256Schema } from "../identifiers/schema";
import { timestampSchema } from "../time";
import { SEED_ANNOTATION_CONFIG } from "./annotation";
import {
  DEFAULT_MODEL_ANNOTATION,
  modelSchema,
  modelVersionSchema,
} from "./schema";

const traditionalManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  definition: z.literal("traditional-v1"),
  createdAt: timestampSchema,
  artifactDigest: sha256Schema,
});

const TRADITIONAL_MODEL_MANIFEST =
  traditionalManifestSchema.parse(traditionalManifest);

/**
 * Models are the tasks the workbench reads: one logical model per
 * purpose, each with many versions. Seed germination ships with the package,
 * its first version a traditional detector that finds every seed and calls it
 * ungerminated, so a deployment can count from its first minute and reviewers
 * mark the germinated ones; every trained version joins the same model and
 * replaces nothing.
 */
export const SEED_DETECTOR_MODEL_ID = "seed-detector";
export const SEED_DETECTOR_BASELINE_VERSION_ID = "traditional-v1";

export const SEED_DETECTOR = modelSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_MODEL_ID,
  name: "Seed germination",
  task: "object_detection",
  classes: SEED_ANNOTATION_CONFIG.classes,
  annotation: {
    ...DEFAULT_MODEL_ANNOTATION,
    area: SEED_ANNOTATION_CONFIG.area,
    instructions: SEED_ANNOTATION_CONFIG.rules,
  },
});

export const SEED_DETECTOR_BASELINE = modelVersionSchema.parse({
  schemaVersion: 1,
  id: SEED_DETECTOR_BASELINE_VERSION_ID,
  modelId: SEED_DETECTOR_MODEL_ID,
  createdAt: TRADITIONAL_MODEL_MANIFEST.createdAt,
  source: {
    kind: "builtin",
    definition: TRADITIONAL_MODEL_MANIFEST.definition,
  },
  artifact: {
    kind: "traditional",
    digest: TRADITIONAL_MODEL_MANIFEST.artifactDigest,
  },
});
