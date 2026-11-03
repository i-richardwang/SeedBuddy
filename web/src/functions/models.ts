import { createServerFn } from "@tanstack/react-start";

import {
  modelAnnotationRequestSchema,
  modelRefSchema,
  modelRequestSchema,
  modelVersionRefSchema,
} from "../domain/models/schema";
import * as modelsService from "../server/models/public";
import {
  listModelOverviews,
  modelDetail,
  versionComparisonDetail,
} from "../server/queries/public";

export const getModelCatalogue = createServerFn({ method: "GET" }).handler(() =>
  listModelOverviews(),
);

export const getModelDetail = createServerFn({ method: "GET" })
  .validator(modelRefSchema)
  .handler(({ data }) => modelDetail(data.model));

export const getVersionComparison = createServerFn({ method: "GET" })
  .validator(modelVersionRefSchema)
  .handler(({ data }) => versionComparisonDetail(data.model, data.version));

export const chooseCurrentVersion = createServerFn({ method: "POST" })
  .validator(modelVersionRefSchema)
  .handler(({ data }) => modelsService.setCurrentVersion(data));

export const createModel = createServerFn({ method: "POST" })
  .validator(modelRequestSchema)
  .handler(({ data }) => modelsService.createModel(data));

export const updateModelAnnotation = createServerFn({ method: "POST" })
  .validator(modelAnnotationRequestSchema)
  .handler(({ data }) => modelsService.setModelAnnotation(data));

export const removeModel = createServerFn({ method: "POST" })
  .validator(modelRefSchema)
  .handler(async ({ data }) => {
    await modelsService.deleteModel(data);
  });
