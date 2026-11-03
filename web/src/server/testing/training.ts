import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import { reviewedDataset as reviewed } from "./datasets";
import { traditionalVersion } from "./models";
import { recordTestHeartbeat, trainingHeartbeat } from "./workers";

export const CONTENTS = ["first-image", "second-image"];

/** Publishing trains new versions, so these runs keep a model of their own. */
export async function trainingDataset(name: string) {
  const { dataset } = await reviewed(
    name,
    CONTENTS,
    await traditionalVersion("training-detector", "training-v1"),
  );
  return dataset;
}

export function owner(
  workerId: string,
  sessionId = `${workerId}-session`,
  attempt = 1,
) {
  return { workerId, sessionId, attempt };
}

export async function trainer(workerId: string) {
  const identity = owner(workerId);
  await recordTestHeartbeat(trainingHeartbeat(identity, new Date()));
  return identity;
}

export const recipe = {
  ...YOLO26N_WHOLE_RECIPE,
  parameters: {
    ...YOLO26N_WHOLE_RECIPE.parameters,
    epochs: 3,
    imgsz: 768,
    batch: 4,
  },
};

export function epochReport(epoch: number) {
  return {
    epoch,
    train: {
      box: 1.5 / epoch,
      classification: 2 / epoch,
      regression: 1 / epoch,
    },
    val: {
      box: 1.6 / epoch,
      classification: 2.1 / epoch,
      regression: 1.1 / epoch,
    },
    precision: 0.2 * epoch,
    recall: 0.25 * epoch,
    map50: 0.3 * epoch,
    map50To95: 0.1 * epoch,
    fitness: 0.12 * epoch,
    learningRate: 0.001,
  };
}

export const publication = {
  schemaVersion: 1 as const,
  weights: "weights/best.pt" as const,
  inference: {
    ready: true as const,
    confidence: 0.42,
    imageSize: 768,
    maxDetections: 500,
    endToEnd: false,
  },
  validation: {
    precision: 0.5,
    recall: 0.4,
    map50: 0.8,
    map50To95: 0.4,
    fitness: 0.44,
  },
  training: {
    baseModel: recipe.baseModel,
    parameters: recipe.parameters,
    runtime: recipe.runtime,
  },
};
