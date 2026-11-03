import { and, eq, sql } from "drizzle-orm";

import type {
  DatasetImageStep,
  DatasetImageView,
} from "../../domain/datasets/image";
import type { DatasetImageRef } from "../../domain/datasets/schema";
import { membershipOrder, readDataset } from "../datasets/public";
import { readUnclearImages } from "../images/public";
import { database } from "../infra/db/client";
import { annotations, datasetImages } from "../infra/db/schema";
import { readModel } from "../models/public";
import { readReview } from "../readings/public";

export async function readDatasetImage(
  ref: DatasetImageRef,
): Promise<DatasetImageView | null> {
  const db = await database();
  const dataset = await readDataset(ref.dataset, db);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId, db);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const members = await db
    .select({
      digest: datasetImages.imageId,
      filename: datasetImages.filename,
      split: datasetImages.split,
      reviewed: sql<boolean>`${annotations.imageId} is not null`,
    })
    .from(datasetImages)
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, datasetImages.imageId),
        eq(annotations.modelId, dataset.modelId),
      ),
    )
    .where(eq(datasetImages.datasetId, ref.dataset))
    .orderBy(...membershipOrder());
  const at = members.findIndex((member) => member.digest === ref.digest);
  if (at < 0) return null;
  const member = members[at]!;
  const review = await readReview(
    { digest: ref.digest, modelId: dataset.modelId },
    member.filename,
    db,
  );
  if (!review) return null;
  const unclear = await readUnclearImages([ref.digest], db);
  const toStep = (
    neighbour: (typeof members)[number] | undefined,
  ): DatasetImageStep | null =>
    neighbour
      ? { digest: neighbour.digest, filename: neighbour.filename }
      : null;
  const following = [...members.slice(at + 1), ...members.slice(0, at)];
  return {
    dataset,
    model,
    review,
    unclear: unclear.has(ref.digest),
    split: member.split,
    position: { index: at + 1, total: members.length },
    previous: toStep(members[at - 1]),
    next: toStep(members[at + 1]),
    nextUnreviewed: toStep(following.find((item) => !item.reviewed)),
  };
}
