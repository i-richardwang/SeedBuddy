import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { datasetRefSchema } from "../domain/datasets/schema";
import { resourceIdSchema } from "../domain/identifiers/schema";
import { trainingOverridesSchema } from "../domain/training/parameters";
import {
  resolveTrainingRecipe,
  trainingPresetIdSchema,
} from "../domain/training/recipes";
import { trainingControlSchema } from "../domain/training/schema";
import { trainingRunDetail } from "../server/queries/public";
import {
  controlTrainingRun,
  createTrainingRun as createTrainingRunService,
} from "../server/training/public";

export const getTrainingRun = createServerFn({ method: "GET" })
  .validator(datasetRefSchema.extend({ runId: resourceIdSchema }))
  .handler(({ data }) => trainingRunDetail(data.dataset, data.runId));

/**
 * Freezes the reviewed annotations into a snapshot and queues one training run
 * of the recipe with the chosen parameters.
 */
export const createTrainingRun = createServerFn({ method: "POST" })
  .validator(
    datasetRefSchema.extend({
      presetId: trainingPresetIdSchema,
      overrides: trainingOverridesSchema,
      targetWorkerId: resourceIdSchema.nullable(),
    }),
  )
  .handler(({ data }) =>
    createTrainingRunService(
      data.dataset,
      resolveTrainingRecipe(data.presetId, data.overrides),
      data.targetWorkerId,
    ),
  );

export const updateTrainingRun = createServerFn({ method: "POST" })
  .validator(
    datasetRefSchema.extend({
      runId: resourceIdSchema,
      attempt: z.number().int().nonnegative(),
      control: trainingControlSchema,
    }),
  )
  .handler(({ data }) =>
    controlTrainingRun(data.dataset, data.runId, data.attempt, data.control),
  );
