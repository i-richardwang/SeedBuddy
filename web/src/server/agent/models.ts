import { z } from "zod";

import { command, query } from "./definition";
import {
  modelAnnotationRequestSchema,
  modelRefSchema,
  modelRequestSchema,
  modelSchema,
  modelVersionRefSchema,
  modelVersionSchema,
} from "../../domain/models/schema";
import {
  modelImportSchema,
  modelUploadRefSchema,
  modelUploadSchema,
} from "../../domain/models/bundle";
import {
  createModel,
  deleteModel,
  importModelUpload,
  listModels,
  listModelVersions,
  prepareModelUpload,
  setCurrentVersion,
  setModelAnnotation,
} from "../models/public";

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
    name: "create-model",
    description:
      "Name a recognition task the workbench does not have yet, with the classes a reviewer will draw. It can be observed and annotated straight away; a version to detect it comes later, from training",
    destructive: false,
    input: modelRequestSchema,
    output: modelSchema,
    handler: (input) => createModel(input),
  }),
  command({
    name: "update-model-annotation",
    description:
      "Change how an AI agent annotates a recognition task: the instructions describing the bodies to box, and the source region each look takes. The classes stay fixed",
    destructive: true,
    input: modelAnnotationRequestSchema,
    output: modelSchema,
    handler: (input) => setModelAnnotation(input),
  }),
  command({
    name: "delete-model",
    description: "Delete a recognition task that holds no records",
    destructive: true,
    input: modelRefSchema,
    output: z.null(),
    handler: (input) => deleteModel(input),
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
    name: "prepare-model-upload",
    description:
      "Validate a model bundle and reserve an idempotent upload. Send weight bytes to uploadPath with an experiments-scoped API key, then call register-model-upload. Does not activate the model.",
    destructive: false,
    transactional: false,
    input: modelImportSchema,
    output: modelUploadSchema,
    handler: ({ model, bundle }) => prepareModelUpload(model, bundle),
  }),
  command({
    name: "register-model-upload",
    description:
      "Register uploaded weights as an immutable model version without training or changing the current version",
    destructive: false,
    transactional: false,
    input: modelUploadRefSchema,
    output: modelVersionSchema,
    handler: ({ uploadId }) => importModelUpload(uploadId),
  }),
  command({
    name: "use-model-version",
    description:
      "Select an existing model version for inference. Does not train; selecting an earlier version rolls back the choice.",
    destructive: true,
    transactional: false,
    input: modelVersionRefSchema,
    output: z.null(),
    handler: async (input) => {
      await setCurrentVersion(input);
      return null;
    },
  }),
];
