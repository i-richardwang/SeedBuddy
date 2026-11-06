import { z } from "zod";

import {
  modelImportSchema,
  modelUploadRefSchema,
  modelUploadSchema,
} from "../../domain/models/bundle";
import {
  modelRefSchema,
  modelRequestSchema,
  modelSchema,
  modelSettingsRequestSchema,
  modelVersionRefSchema,
  modelVersionSchema,
} from "../../domain/models/schema";
import {
  createModel,
  deleteModel,
  importModelUpload,
  listModels,
  listModelVersions,
  prepareModelUpload,
  setCurrentVersion,
  setModelSettings,
} from "../models/public";
import { command, query } from "./definition";

/**
 * A model is a recognition task: the question an observation asks of its
 * photographs. Its versions are the machines that have learned to answer it.
 */
export const modelOperations = [
  query({
    name: "list-models",
    description:
      "List the recognition tasks an observation may be read for, and the classes each one finds",
    input: z.strictObject({}),
    output: z.array(modelSchema),
    handler: () => listModels(),
  }),
  command({
    transaction: "operation",
    name: "create-model",
    description:
      "Name a recognition task the workbench does not have yet, with the classes a reviewer will draw and, for a task about the culture dish, area 'dish' so that AI annotation, training and detection keep to the dish each photo shows. It can be observed and annotated straight away; a version to detect it comes later, from training",
    destructive: false,
    input: modelRequestSchema,
    output: modelSchema,
    handler: (input, db) => createModel(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-model-settings",
    description:
      "Change where a recognition task looks ('dish' keeps AI annotation, training and detection to the culture dish; 'image' uses the whole photo) and how an AI agent annotates it: the instructions describing the bodies to box, and the source region each look takes. The classes stay fixed; runs, snapshots and versions already made keep the settings they were made with",
    destructive: true,
    input: modelSettingsRequestSchema,
    output: modelSchema,
    handler: (input, db) => setModelSettings(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-model",
    description: "Delete a recognition task that holds no records",
    destructive: true,
    input: modelRefSchema,
    output: z.null(),
    handler: (input, db) => deleteModel(input, db),
  }),
  query({
    name: "list-model-versions",
    description:
      "List up to 100 newest immutable versions for a recognition model, including locally trained imports",
    input: modelRefSchema,
    output: z.array(modelVersionSchema),
    handler: ({ model }) => listModelVersions(model),
  }),
  command({
    transaction: "service",
    name: "prepare-model-upload",
    description:
      "Validate a model bundle and reserve an idempotent upload. Send weight bytes to uploadPath with an experiments-scoped API key, then call register-model-upload. Does not activate the model.",
    destructive: false,
    input: modelImportSchema,
    output: modelUploadSchema,
    handler: ({ model, bundle }) => prepareModelUpload(model, bundle),
  }),
  command({
    transaction: "service",
    name: "register-model-upload",
    description:
      "Register uploaded weights as an immutable model version without training or changing the current version",
    destructive: false,
    input: modelUploadRefSchema,
    output: modelVersionSchema,
    handler: ({ uploadId }) => importModelUpload(uploadId),
  }),
  command({
    transaction: "service",
    name: "use-model-version",
    description:
      "Select an existing model version for inference. Does not train; selecting an earlier version rolls back the choice.",
    destructive: true,
    input: modelVersionRefSchema,
    output: z.null(),
    handler: async (input) => {
      await setCurrentVersion(input);
      return null;
    },
  }),
];
