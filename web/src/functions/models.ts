import { createServerFn } from "@tanstack/react-start";

import {
  modelAnnotationRequestSchema,
  modelRefSchema,
  modelRequestSchema,
  modelVersionRefSchema,
} from "../domain/models/schema";
import {
  createModel,
  deleteModel,
  setCurrentVersion,
  setModelAnnotation,
} from "../server/models/public";
import {
  modelCatalogue,
  modelDetail,
  versionComparison,
} from "../server/queries/public";

export const getModelCatalogue = createServerFn({ method: "GET" }).handler(() =>
  modelCatalogue(),
);

export const getModelDetail = createServerFn({ method: "GET" })
  .validator(modelRefSchema)
  .handler(({ data }) => modelDetail(data.model));

export const getVersionComparison = createServerFn({ method: "GET" })
  .validator(modelVersionRefSchema)
  .handler(({ data }) => versionComparison(data.model, data.version));

export const chooseCurrentVersion = createServerFn({ method: "POST" })
  .validator(modelVersionRefSchema)
  .handler(({ data }) => setCurrentVersion(data));

export const addModel = createServerFn({ method: "POST" })
  .validator(modelRequestSchema)
  .handler(({ data }) => createModel(data));

export const updateModelAnnotation = createServerFn({ method: "POST" })
  .validator(modelAnnotationRequestSchema)
  .handler(({ data }) => setModelAnnotation(data));

export const removeModel = createServerFn({ method: "POST" })
  .validator(modelRefSchema)
  .handler(async ({ data }) => {
    await deleteModel(data);
  });
