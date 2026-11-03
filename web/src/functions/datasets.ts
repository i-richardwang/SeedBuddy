import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageAdditionSchema,
  datasetImageRefSchema,
  datasetImageRemovalSchema,
  datasetRefSchema,
  datasetUpdateSchema,
  newDatasetImageAdditionSchema,
} from "../domain/datasets/schema";
import {
  addExperimentObservationImages,
  addExperimentObservationImagesToNewDataset,
  removeDatasetImages,
  updateDataset,
} from "../server/datasets/public";
import { datasetDetail, readDatasetImage } from "../server/queries/public";

export const getDatasetDetail = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => datasetDetail(data.dataset));

export const getDatasetImage = createServerFn({ method: "GET" })
  .validator(datasetImageRefSchema)
  .handler(({ data }) => readDatasetImage(data));

export const addToDataset = createServerFn({ method: "POST" })
  .validator(datasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImages(data));

/** Founds a dataset for the images' model and adds them, in one step. */
export const addToNewDataset = createServerFn({ method: "POST" })
  .validator(newDatasetImageAdditionSchema)
  .handler(({ data }) => addExperimentObservationImagesToNewDataset(data));

export const editDataset = createServerFn({ method: "POST" })
  .validator(datasetUpdateSchema)
  .handler(({ data }) => updateDataset(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRemovalSchema)
  .handler(({ data }) => removeDatasetImages(data));
