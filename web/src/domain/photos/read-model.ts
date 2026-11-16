import type { PhotoBatch } from "./schema";

/** A batch in its owner's list, with how many photographs still wait in it. */
export interface PhotoBatchOverview extends PhotoBatch {
  photoCount: number;
}

/** A photograph waiting in a batch. */
export interface BatchPhotoOverview {
  digest: string;
  filename: string;
  width: number;
  height: number;
  bytes: number;
}

/** A batch's page: the batch and the photographs waiting in it, in the order of their file names. */
export interface PhotoBatchDetail {
  batch: PhotoBatch;
  photos: BatchPhotoOverview[];
}
