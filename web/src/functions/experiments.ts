import { createServerFn } from "@tanstack/react-start";

import {
  cultureEventRefSchema,
  cultureEventsRequestSchema,
} from "../domain/experiments/culture-events";
import { placedPhotosRequestSchema } from "../domain/experiments/photos";
import { experimentPageRequestSchema } from "../domain/experiments/read-model";
import {
  experimentRefSchema,
  experimentRequestSchema,
  experimentUpdateSchema,
  manualEntryRequestSchema,
  manualReadingsRequestSchema,
  observationImageAssignmentSchema,
  observationImageRefSchema,
  observationRecordSchema,
  observationRefSchema,
  observationUpdateSchema,
  photoSlotsRequestSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitRequestSchema,
  unitsTreatmentUpdateSchema,
  unitUpdateSchema,
} from "../domain/experiments/schema";
import {
  addReplicates,
  addTreatment,
  assignObservationImages,
  createExperiment as createExperimentService,
  deleteCultureEvent,
  deleteExperiment,
  deleteObservation,
  deleteTreatment,
  deleteUnit,
  moveUnits,
  recordCultureEvents,
  recordManualReadings,
  recordObservation,
  retryObservationImageAnalysis,
  unassignObservationImage,
  updateExperiment as updateExperimentService,
  updateObservation as updateObservationService,
  updateTreatment as updateTreatmentService,
  updateUnit as updateUnitService,
} from "../server/experiments/public";
import {
  experimentPage,
  experimentProgressDetail,
  findExperimentNames,
  findPlacedPhotos,
  listExperimentOverviews,
  manualEntryDetail,
  photoSlotsDetail,
  unitWorkbench,
} from "../server/queries/public";

export const getExperiments = createServerFn({ method: "GET" }).handler(() =>
  listExperimentOverviews(),
);

export const getExperimentNames = createServerFn({ method: "GET" }).handler(
  () => findExperimentNames(),
);

/**
 * The experiment's page: its frame, the models an observation may be read
 * for, and the view on show, a page of units or the summary.
 */
export const getExperimentPage = createServerFn({ method: "GET" })
  .validator(experimentPageRequestSchema)
  .handler(({ data }) => experimentPage(data.experiment, data.view));

/** How many photographs the experiment holds, and how many still wait for their reading. */
export const getExperimentProgress = createServerFn({ method: "GET" })
  .validator(experimentRefSchema)
  .handler(({ data }) => experimentProgressDetail(data.experiment));

/** The units a day's photographs are placed on, and those the day holds one of. */
export const getPhotoSlots = createServerFn({ method: "GET" })
  .validator(photoSlotsRequestSchema)
  .handler(({ data }) => photoSlotsDetail(data));

/** One treatment's units on a day, as counts are entered for them. */
export const getManualEntry = createServerFn({ method: "GET" })
  .validator(manualEntryRequestSchema)
  .handler(({ data }) => manualEntryDetail(data));

/**
 * Which of a batch's photographs the experiment already holds. A read, sent
 * as a POST because a batch of digests outgrows an address.
 */
export const getPlacedPhotos = createServerFn({ method: "POST" })
  .validator(placedPhotosRequestSchema)
  .handler(({ data }) => findPlacedPhotos(data.experiment, data.digests));

export const createExperiment = createServerFn({ method: "POST" })
  .validator(experimentRequestSchema)
  .handler(({ data }) => createExperimentService(data));

export const updateExperiment = createServerFn({ method: "POST" })
  .validator(experimentUpdateSchema)
  .handler(({ data }) => updateExperimentService(data));

export const removeExperiment = createServerFn({ method: "POST" })
  .validator(experimentRefSchema)
  .handler(({ data }) => deleteExperiment(data));

export const createTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRequestSchema)
  .handler(({ data }) => addTreatment(data));

export const updateTreatment = createServerFn({ method: "POST" })
  .validator(treatmentUpdateSchema)
  .handler(({ data }) => updateTreatmentService(data));

export const removeTreatment = createServerFn({ method: "POST" })
  .validator(treatmentRefSchema)
  .handler(({ data }) => deleteTreatment(data));

export const createReplicates = createServerFn({ method: "POST" })
  .validator(replicateRequestSchema)
  .handler(({ data }) => addReplicates(data));

export const getUnitDetail = createServerFn({ method: "GET" })
  .validator(unitRequestSchema)
  .handler(({ data: { observation, treatment, ...ref } }) =>
    unitWorkbench(ref, { observation, treatment }),
  );

export const updateUnit = createServerFn({ method: "POST" })
  .validator(unitUpdateSchema)
  .handler(({ data }) => updateUnitService(data));

export const updateUnitsTreatment = createServerFn({ method: "POST" })
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

export const createObservation = createServerFn({ method: "POST" })
  .validator(observationRecordSchema)
  .handler(({ data }) => recordObservation(data));

export const updateObservation = createServerFn({ method: "POST" })
  .validator(observationUpdateSchema)
  .handler(({ data }) => updateObservationService(data));

export const removeObservation = createServerFn({ method: "POST" })
  .validator(observationRefSchema)
  .handler(({ data }) => deleteObservation(data));

export const updateManualReadings = createServerFn({ method: "POST" })
  .validator(manualReadingsRequestSchema)
  .handler(({ data }) => recordManualReadings(data));

export const updateObservationImages = createServerFn({ method: "POST" })
  .validator(observationImageAssignmentSchema)
  .handler(({ data }) => assignObservationImages(data));

export const removeObservationImage = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(({ data }) => unassignObservationImage(data));

export const createImageAnalysisRetry = createServerFn({ method: "POST" })
  .validator(observationImageRefSchema)
  .handler(async ({ data }) => {
    await retryObservationImageAnalysis(data);
  });
