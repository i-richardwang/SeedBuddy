import { createServerFn } from "@tanstack/react-start";

import {
  datasetImageAdditionSchema,
  datasetImageRefSchema,
  datasetImageRemovalSchema,
  datasetRefSchema,
  datasetUpdateSchema,
  newDatasetImageAdditionSchema,
} from "../domain/datasets/schema";
import * as datasetsService from "../server/datasets/public";
import { datasetDetail, datasetImageDetail } from "../server/queries/public";

export const getDatasetDetail = createServerFn({ method: "GET" })
  .validator(datasetRefSchema)
  .handler(({ data }) => datasetDetail(data.dataset));

export const getDatasetImage = createServerFn({ method: "GET" })
  .validator(datasetImageRefSchema)
  .handler(({ data }) => datasetImageDetail(data));

export const createDatasetMemberships = createServerFn({ method: "POST" })
  .validator(datasetImageAdditionSchema)
  .handler(({ data }) => datasetsService.addExperimentObservationImages(data));

/** Founds a dataset for the images' model and adds them, in one step. */
export const createDatasetFromImages = createServerFn({ method: "POST" })
  .validator(newDatasetImageAdditionSchema)
  .handler(({ data }) =>
    datasetsService.addExperimentObservationImagesToNewDataset(data),
  );

export const updateDataset = createServerFn({ method: "POST" })
  .validator(datasetUpdateSchema)
  .handler(({ data }) => datasetsService.updateDataset(data));

export const removeFromDataset = createServerFn({ method: "POST" })
  .validator(datasetImageRemovalSchema)
  .handler(({ data }) => datasetsService.removeDatasetImages(data));
