import { createServerFn } from "@tanstack/react-start";

import type { NamedDataset } from "../domain/datasets/schema";
import {
  cultureEventRefSchema,
  cultureEventsRequestSchema,
} from "../domain/experiments/culture-events";
import {
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  manualReadingsRequestSchema,
  observationImageAssignmentSchema,
  observationImageRefSchema,
  observationRecordSchema,
  observationRefSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitRequestSchema,
  unitsTreatmentUpdateSchema,
  unitUpdateSchema,
} from "../domain/experiments/schema";
import { listDatasets, listDatasetsForModel } from "../server/datasets/public";
import * as experimentsService from "../server/experiments/public";
import { listModels } from "../server/models/public";

async function datasetsTraining(modelId: string): Promise<NamedDataset[]> {
  return (await listDatasetsForModel(modelId)).map(({ id, name }) => ({
    id,
    name,
  }));
}

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  experimentsService.listExperimentOverviews(),
);

export const getExperimentNames = createServerFn({ method: "GET" }).handler(
  () => experimentsService.findExperimentNames(),
);

/**
 * The grid with what its page edits it against: the models an observation may
 * be read for and the datasets its images may join.
 */
export const getExperimentGrid = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(async ({ data }) => {
    const grid = await experimentsService.experimentGridDetail(data.experiment);
    if (!grid) return null;
    const [models, datasets] = await Promise.all([
      listModels(),
      listDatasets(),
    ]);
    return { ...grid, models, datasets };
  });

export const createExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => experimentsService.createExperiment(data));

export const updateExperiment = createServerFn({ method: "POST" })
  .validator(experimentUpdateSchema)
  .handler(({ data }) => experimentsService.updateExperiment(data));

export const removeExperiment = createServerFn({ method: "POST" })
  .validator(experimentRefSchema)
  .handler(({ data }) => experimentsService.deleteExperiment(data));

export const createTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRequestSchema)
  .handler(({ data }) => experimentsService.addTreatment(data));

export const updateTreatment = createServerFn({ method: "POST" })
  .validator(treatmentUpdateSchema)
  .handler(({ data }) => experimentsService.updateTreatment(data));

export const removeTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRefSchema)
  .handler(({ data }) => experimentsService.deleteTreatment(data));

export const createReplicates = createServerFn({ method: "POST" })
  .validator(replicateRequestSchema)
  .handler(({ data }) => experimentsService.addReplicates(data));

export const getUnit = createServerFn({ method: "GET" })
  .validator(unitRequestSchema)
  .handler(async ({ data: { observation, ...ref } }) => {
    const series = await experimentsService.unitDetail(ref, observation);
    if (!series) return null;
    const datasets = series.shown
      ? await datasetsTraining(series.shown.model.id)
      : [];
    return { ...series, datasets };
  });

export const updateUnit = createServerFn({ method: "POST" })
  .validator(unitUpdateSchema)
  .handler(({ data }) => experimentsService.updateUnit(data));

export const updateUnitsTreatment = createServerFn({ method: "POST" })
  .validator(unitsTreatmentUpdateSchema)
  .handler(({ data }) => experimentsService.moveUnits(data));

export const removeUnit = createServerFn({ method: "POST" })
  .validator(unitRefSchema)
  .handler(({ data }) => experimentsService.deleteUnit(data));

export const createCultureEvents = createServerFn({ method: "POST" })
  .validator(cultureEventsRequestSchema)
  .handler(({ data }) => experimentsService.recordCultureEvents(data));

export const removeCultureEvent = createServerFn({ method: "POST" })
  .validator(cultureEventRefSchema)
  .handler(({ data }) => experimentsService.deleteCultureEvent(data));

export const createObservation = createServerFn({ method: "POST" })
  .validator(observationRecordSchema)
  .handler(({ data }) => experimentsService.recordObservation(data));

export const updateObservation = createServerFn({ method: "POST" })
  .validator(observationUpdateSchema)
  .handler(({ data }) => experimentsService.updateObservation(data));

export const removeObservation = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(({ data }) => experimentsService.deleteObservation(data));

export const updateManualReadings = createServerFn({ method: "POST" })
  .validator(manualReadingsRequestSchema)
  .handler(({ data }) => experimentsService.recordManualReadings(data));

export const updateObservationImages = createServerFn({ method: "POST" })
  .validator(observationImageAssignmentSchema)
  .handler(({ data }) => experimentsService.assignObservationImages(data));

export const removeObservationImage = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(({ data }) => experimentsService.unassignObservationImage(data));

export const retryImageAnalysis = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(async ({ data }) => {
    await experimentsService.retryObservationImageAnalysis(data);
  });
