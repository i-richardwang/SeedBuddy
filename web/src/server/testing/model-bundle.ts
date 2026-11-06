import type { ModelBundle } from "../../domain/models/bundle";
import type { InferenceMode } from "../../domain/models/inference";
import type { TrainingRecipe } from "../../domain/training/schema";
import { contentDigest } from "../infra/digest";

export function trainingBundle(
  weights: Uint8Array,
  publication: {
    training: TrainingRecipe;
    inference: {
      confidence: number;
      imageSize: number;
      maxDetections: number;
      endToEnd: boolean;
    };
    validation: ModelBundle["validation"];
  },
  classes: string[],
  snapshotId: string,
  mode: InferenceMode = "whole_image",
): ModelBundle {
  const { confidence, imageSize, maxDetections, endToEnd } =
    publication.inference;
  return {
    schemaVersion: 1,
    classes,
    weights: { digest: contentDigest(weights), bytes: weights.byteLength },
    inference: {
      mode,
      iou: 0.7,
      confidence,
      imageSize,
      maxDetections,
      endToEnd,
    },
    training: publication.training,
    validation: publication.validation,
    provenance: {
      dataset: { fingerprint: null, snapshotId, description: "Test snapshot" },
      selectedEpoch: null,
      codeRevision: null,
      effectiveParameters: publication.training.parameters,
      evaluation: {
        description: "Snapshot validation split",
        calibration: "Best F1",
        metrics: publication.validation,
      },
    },
  };
}
