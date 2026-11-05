import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageAdditionSchema,
  datasetImageRefSchema,
  datasetImageRemovalSchema,
  datasetRefSchema,
  datasetUpdateSchema,
  newDatasetImageAdditionSchema,
} from "../domain/datasets/schema";
import { modelRefSchema } from "../domain/models/schema";
import {
  addExperimentObservationImages,
  addExperimentObservationImagesToNewDataset,
  removeDatasetImages,
  updateDataset as updateDatasetService,
} from "../server/datasets/public";
import {
  datasetDetail,
  datasetImageDetail,
  modelDatasetsDetail,
} from "../server/queries/public";

export const getDatasetDetail = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => datasetDetail(data.dataset));

/** The datasets that train a model, which its photographs may join. */
export const getModelDatasets = createServerFn({ method: "GET" })
  .validator(modelRefSchema)
  .handler(({ data }) => modelDatasetsDetail(data.model));

export const getDatasetImageDetail = createServerFn({ method: "GET" })
  .validator(datasetImageRefSchema)
  .handler(({ data }) => datasetImageDetail(data));

export const createDatasetMemberships = createServerFn({ method: "POST" })
  .validator(datasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImages(data));

/** Founds a dataset for the images' model and adds them, in one step. */
export const createDatasetFromImages = createServerFn({ method: "POST" })
  .validator(newDatasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImagesToNewDataset(data));

export const updateDataset = createServerFn({ method: "POST" })
  .validator(datasetUpdateSchema)
  .handler(({ data }) => updateDatasetService(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRemovalSchema)
  .handler(({ data }) => removeDatasetImages(data));
