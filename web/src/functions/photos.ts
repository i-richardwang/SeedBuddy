import { createServerFn } from "@tanstack/react-start";

import {
  batchPhotoAdditionSchema,
  batchPhotoRefSchema,
  photoBatchRefSchema,
  photoBatchRequestSchema,
} from "../domain/photos/schema";
import {
  addBatchPhoto,
  createPhotoBatch as createPhotoBatchService,
  deletePhotoBatch,
  listPhotoBatchOverviews,
  photoBatchDetail,
  removeBatchPhoto as removeBatchPhotoService,
} from "../server/photos/public";
import { requireAccount } from "./access";

/** The reader's own batches of photographs waiting to be placed. */
export const getPhotoBatches = createServerFn({ method: "GET" }).handler(
  async () => listPhotoBatchOverviews((await requireAccount()).id),
);

export const getPhotoBatchDetail = createServerFn({ method: "GET" })
  .validator(photoBatchRefSchema)
  .handler(async ({ data }) =>
    photoBatchDetail((await requireAccount()).id, data),
  );

export const createPhotoBatch = createServerFn({ method: "POST" })
  .validator(photoBatchRequestSchema)
  .handler(async ({ data }) =>
    createPhotoBatchService((await requireAccount()).id, data),
  );

export const removePhotoBatch = createServerFn({ method: "POST" })
  .validator(photoBatchRefSchema)
  .handler(async ({ data }) =>
    deletePhotoBatch((await requireAccount()).id, data),
  );

export const createBatchPhoto = createServerFn({ method: "POST" })
  .validator(batchPhotoAdditionSchema)
  .handler(async ({ data }) =>
    addBatchPhoto((await requireAccount()).id, data),
  );

export const removeBatchPhoto = createServerFn({ method: "POST" })
  .validator(batchPhotoRefSchema)
  .handler(async ({ data }) =>
    removeBatchPhotoService((await requireAccount()).id, data),
  );
