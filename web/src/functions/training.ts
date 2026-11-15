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
import { requireAccount } from "./access";

export const getTrainingRunDetail = createServerFn({ method: "GET" })
  .validator(datasetRefSchema.extend({ runId: resourceIdSchema }))
  .handler(async ({ data }) =>
    trainingRunDetail(data.dataset, data.runId, (await requireAccount()).id),
  );

/**
 * Freezes the reviewed annotations into a snapshot and queues one training run
 * of the recipe with the chosen parameters, as the signed-in account.
 */
export const createTrainingRun = createServerFn({ method: "POST" })
  .validator(
    datasetRefSchema.extend({
      presetId: trainingPresetIdSchema,
      overrides: trainingOverridesSchema,
      targetWorkerId: resourceIdSchema.nullable(),
    }),
  )
  .handler(async ({ data }) =>
    createTrainingRunService(
      data.dataset,
      resolveTrainingRecipe(data.presetId, data.overrides),
      data.targetWorkerId,
      (await requireAccount()).id,
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
  .handler(async ({ data }) =>
    controlTrainingRun(
      data.dataset,
      data.runId,
      data.attempt,
      data.control,
      (await requireAccount()).id,
    ),
  );
