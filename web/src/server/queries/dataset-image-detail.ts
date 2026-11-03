import { and, eq, sql } from "drizzle-orm";

import type {
  DatasetImageDetail,
  DatasetImageStep,
} from "../../domain/datasets/read-model";
import type { DatasetImageRef } from "../../domain/datasets/schema";
import { datasetMembershipOrder, readDataset } from "../datasets/public";
import { readUnclearImages } from "../images/public";
import { snapshot } from "../infra/db/client";
import { annotations, datasetImages } from "../infra/db/schema";
import { requireModel } from "../models/public";
import { readReview } from "../readings/public";

export async function datasetImageDetail(
  ref: DatasetImageRef,
): Promise<DatasetImageDetail | null> {
  return snapshot(async (db) => {
    const dataset = await readDataset(ref.dataset, db);
    if (!dataset) return null;
    const model = await requireModel(dataset.modelId, db);
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
      .orderBy(...datasetMembershipOrder());
    const index = members.findIndex((member) => member.digest === ref.digest);
    if (index < 0) return null;
    const member = members[index]!;
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
    const following = [...members.slice(index + 1), ...members.slice(0, index)];
    return {
      dataset,
      model,
      review,
      unclear: unclear.has(ref.digest),
      split: member.split,
      position: { index: index + 1, total: members.length },
      previous: toStep(members[index - 1]),
      next: toStep(members[index + 1]),
      nextUnreviewed: toStep(following.find((item) => !item.reviewed)),
    };
  });
}
