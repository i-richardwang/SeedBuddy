import { createServerFn } from "@tanstack/react-start";

import {
  cultureEventRefSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  manualReadingsRequestSchema,
  observationImageAssignmentSchema,
  observationImageRefSchema,
  observationRefSchema,
  observationRecordSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitRequestSchema,
  unitsTreatmentUpdateSchema,
  unitUpdateSchema,
  cultureEventsRequestSchema,
} from "../domain/experiments/schema";
import type { NamedDataset } from "../domain/datasets/schema";
import { listDatasets, listDatasetsForModel } from "../server/datasets/public";
import {
  addReplicates,
  addTreatment,
  createExperiment,
  deleteExperiment,
  deleteTreatment,
  deleteUnit,
  moveUnits,
  updateExperiment,
  updateTreatment,
  updateUnit,
  deleteCultureEvent,
  recordCultureEvents,
  recordManualReadings,
  deleteObservation,
  updateObservation,
  listExperimentNames,
  listExperiments,
  readExperimentGrid,
  readUnit,
  recordObservation as recordObservationRecord,
  assignObservationImages,
  unassignObservationImage as unassignObservationImageRecord,
  retryObservationImageAnalysis as retryObservationImageAnalysisRecord,
} from "../server/experiments/public";

import { listModels } from "../server/models/public";

async function datasetsTraining(modelId: string): Promise<NamedDataset[]> {
  return (await listDatasetsForModel(modelId)).map(({ id, name }) => ({
    id,
    name,
  }));
}

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  listExperiments(),
);

export const getExperimentNames = createServerFn({ method: "GET" }).handler(
  () => listExperimentNames(),
);

/**
 * The grid with what its page edits it against: the models an observation may
 * be read for and the datasets its images may join.
 */
export const getExperimentGrid = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(async ({ data }) => {
    const grid = await readExperimentGrid(data.experiment);
    if (!grid) return null;
    const [models, datasets] = await Promise.all([
      listModels(),
      listDatasets(),
    ]);
    return { ...grid, models, datasets };
  });

export const startExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => createExperiment(data));

export const editExperiment = createServerFn({ method: "POST" })
  .validator(experimentUpdateSchema)
  .handler(({ data }) => updateExperiment(data));

export const removeExperiment = createServerFn({ method: "POST" })
  .validator(experimentRefSchema)
  .handler(({ data }) => deleteExperiment(data));

export const createTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRequestSchema)
  .handler(({ data }) => addTreatment(data));

export const editTreatment = createServerFn({ method: "POST" })
  .validator(treatmentUpdateSchema)
  .handler(({ data }) => updateTreatment(data));

export const removeTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRefSchema)
  .handler(({ data }) => deleteTreatment(data));

export const createReplicates = createServerFn({ method: "POST" })
  .validator(replicateRequestSchema)
  .handler(({ data }) => addReplicates(data));

export const getUnit = createServerFn({ method: "GET" })
  .validator(unitRequestSchema)
  .handler(async ({ data: { observation, ...ref } }) => {
    const series = await readUnit(ref, observation);
    if (!series) return null;
    const datasets = series.shown
      ? await datasetsTraining(series.shown.model.id)
      : [];
    return { ...series, datasets };
  });

export const editUnit = createServerFn({ method: "POST" })
  .validator(unitUpdateSchema)
  .handler(({ data }) => updateUnit(data));

export const editUnitsTreatment = createServerFn({ method: "POST" })
  .validator(unitsTreatmentUpdateSchema)
  .handler(({ data }) => moveUnits(data));

export const removeUnit = createServerFn({ method: "POST" })
  .validator(unitRefSchema)
  .handler(({ data }) => deleteUnit(data));

export const createCultureEvents = createServerFn({ method: "POST" })
  .validator(cultureEventsRequestSchema)
  .handler(({ data }) => recordCultureEvents(data));

export const removeCultureEvent = createServerFn({ method: "POST" })
  .validator(cultureEventRefSchema)
  .handler(({ data }) => deleteCultureEvent(data));

export const recordObservation = createServerFn({ method: "POST" })
  .validator(observationRecordSchema)
  .handler(({ data }) => recordObservationRecord(data));

export const editObservation = createServerFn({ method: "POST" })
  .validator(observationUpdateSchema)
  .handler(({ data }) => updateObservation(data));

export const removeObservation = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(({ data }) => deleteObservation(data));

export const enterManualReadings = createServerFn({ method: "POST" })
  .validator(manualReadingsRequestSchema)
  .handler(({ data }) => recordManualReadings(data));

export const assignImagesToObservation = createServerFn({ method: "POST" })
  .validator(observationImageAssignmentSchema)
  .handler(({ data }) => assignObservationImages(data));

export const unassignObservationImage = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(({ data }) => unassignObservationImageRecord(data));

export const retryObservationImageAnalysis = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(async ({ data }) => {
    await retryObservationImageAnalysisRecord(data);
  });
