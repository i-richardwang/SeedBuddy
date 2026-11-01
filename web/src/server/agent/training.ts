import { z } from "zod";

import { command, query } from "./definition";
import { resourceIdSchema } from "../../domain/identifiers/schema";
import { modelRefSchema } from "../../domain/models/schema";
import { datasetRefSchema } from "../../domain/datasets/schema";
import {
  trainingRunSchema,
  trainingRecipeSchema,
  trainingControlSchema,
  trainingEpochSchema,
} from "../../domain/training/schema";
import { TrainingRunNotFoundError } from "../../domain/training/errors";
import {
  createTrainingRun,
  readTrainingRun,
  readDatasetSnapshot,
  controlTrainingRun,
  listTrainingRunSummaries,
  listTrainingEpochs,
} from "../training/public";
import { trainingWorkerOptions } from "../queries/public";

export const trainingOperations = [
  query({
    name: "list-training-workers",
    description: "List training workers and whether they are online",
    input: z.strictObject({}),
    output: z.array(
      z.strictObject({ workerId: resourceIdSchema, online: z.boolean() }),
    ),
    handler: () => trainingWorkerOptions(),
  }),
  command({
    name: "start-training-run",
    description:
      "Freeze reviewed dataset contents and queue training on an optional target worker; returns immediately with a run id. Supply the complete immutable recipe.",
    destructive: false,
    transactional: false,
    input: datasetRefSchema.extend({
      recipe: trainingRecipeSchema,
      targetWorkerId: resourceIdSchema.nullable(),
    }),
    output: trainingRunSchema,
    handler: ({ dataset, recipe, targetWorkerId }) =>
      createTrainingRun(dataset, recipe, targetWorkerId),
  }),
  query({
    name: "get-training-run",
    description:
      "Read training state, current execution identity and epoch metrics",
    input: z.strictObject({ runId: resourceIdSchema }),
    output: z.strictObject({
      run: trainingRunSchema,
      datasetId: resourceIdSchema,
      epochs: z.array(trainingEpochSchema),
    }),
    handler: async ({ runId }) => {
      const run = await readTrainingRun(runId);
      if (!run)
        throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
      const snapshot = await readDatasetSnapshot(run.datasetSnapshotId);
      if (!snapshot)
        throw new TrainingRunNotFoundError("Training snapshot is missing");
      return {
        run,
        datasetId: snapshot.datasetId,
        epochs: await listTrainingEpochs(runId),
      };
    },
  }),
  query({
    name: "list-training-runs",
    description: "List up to 100 recent training runs for a model",
    input: modelRefSchema,
    output: z.array(trainingRunSchema),
    handler: async ({ model }) =>
      (await listTrainingRunSummaries({ modelId: model })).map(
        (summary) => summary.run,
      ),
  }),
  command({
    name: "control-training-run",
    description:
      "Pause, cancel or resume a training run using the observed attempt number; resume can assign another worker or explicitly restart",
    destructive: true,
    transactional: false,
    input: datasetRefSchema.extend({
      runId: resourceIdSchema,
      attempt: z.number().int().nonnegative(),
      control: trainingControlSchema,
    }),
    output: trainingRunSchema,
    handler: ({ dataset, runId, attempt, control }) =>
      controlTrainingRun(dataset, runId, attempt, control),
  }),
];
