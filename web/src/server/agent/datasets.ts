import { z } from "zod";

import { DatasetNotFoundError } from "../../domain/datasets/errors";
import { datasetOverviewSchema } from "../../domain/datasets/read-model";
import {
  datasetContentsSchema,
  datasetImageAdditionResultSchema,
  datasetImageAdditionSchema,
  datasetImageRemovalResultSchema,
  datasetImageRemovalSchema,
  datasetListRequestSchema,
  datasetRefSchema,
  datasetRequestSchema,
  datasetSchema,
  datasetUpdateSchema,
} from "../../domain/datasets/schema";
import {
  addExperimentObservationImages,
  createDataset,
  listDatasetOverviews,
  readDatasetContents,
  removeDatasetImages,
  updateDataset,
} from "../datasets/public";
import { command, query } from "./definition";

/** A dataset gathers the photographs that train one recognition task. */
export const datasetOperations = [
  query({
    name: "list-datasets",
    description:
      "List the datasets that train each recognition task, optionally for one model, with each one's id and name, how many images it holds, and how many of those are reviewed; training uses only reviewed images",
    input: datasetListRequestSchema,
    output: z.array(datasetOverviewSchema),
    handler: ({ modelId }) => listDatasetOverviews(modelId),
  }),
  query({
    name: "get-dataset",
    description:
      "Read one dataset's images by digest, each with whether it is reviewed, whether a person marked it unclear, and the training split a snapshot gave it; match digests against the photographs in get-experiment's cells to see where an image was observed",
    input: datasetRefSchema,
    output: datasetContentsSchema,
    handler: async ({ dataset }) => {
      const contents = await readDatasetContents(dataset);
      if (!contents) {
        throw new DatasetNotFoundError(`Unknown dataset: ${dataset}`);
      }
      return contents;
    },
  }),
  command({
    transaction: "operation",
    name: "create-dataset",
    description:
      "Create an empty dataset that trains one recognition task; its name is unique whatever its case and stays filename-safe, because transfer and data roots know a dataset by name",
    destructive: false,
    input: datasetRequestSchema,
    output: datasetSchema,
    handler: (input, db) => createDataset(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-dataset",
    description:
      "Rename a dataset; its images, training splits, snapshots, and runs stay with it",
    destructive: true,
    input: datasetUpdateSchema,
    output: datasetSchema,
    handler: (input, db) => updateDataset(input, db),
  }),
  command({
    transaction: "operation",
    name: "add-images-to-dataset",
    description:
      "Add experiment photographs to a dataset that trains their observation's model, by the observation image id each cell carries. All images must be observed for that model; images already in the dataset are counted as existing, so repeating a call is safe. Training splits are assigned when a snapshot is taken",
    destructive: false,
    input: datasetImageAdditionSchema,
    output: datasetImageAdditionResultSchema,
    handler: (input, db) => addExperimentObservationImages(input, db),
  }),
  command({
    transaction: "operation",
    name: "remove-images-from-dataset",
    description:
      "Take images out of a dataset by digest so later training leaves them out. The images, their reviews, and snapshots already taken remain; digests not in the dataset are counted as absent, so repeating a call is safe",
    destructive: true,
    input: datasetImageRemovalSchema,
    output: datasetImageRemovalResultSchema,
    handler: (input, db) => removeDatasetImages(input, db),
  }),
];
