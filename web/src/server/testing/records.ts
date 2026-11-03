import { and, eq } from "drizzle-orm";

import type { AnnotationRef } from "../../domain/annotation/schema";
import { listImageRecords } from "../datasets/records";
import { database } from "../infra/db/client";
import { inferenceOutcomes } from "../infra/db/schema";
import { readReadings } from "../readings/public";

export async function readImageRecord(ref: {
  dataset: string;
  digest: string;
}) {
  return (
    (await listImageRecords(ref.dataset)).find(
      (record) => record.image.digest === ref.digest,
    ) ?? null
  );
}

/** The succeeded outcome stored for one image-version pair, if any. */
export async function storedDetection(target: {
  versionId: string;
  digest: string;
}) {
  const db = await database();
  const [row] = await db
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
      ),
    );
  return row?.document ?? null;
}

/** Read reviews through the production readings query. */
export async function readAnnotation(ref: AnnotationRef) {
  return (await readReadings(ref, await database()))?.annotation ?? null;
}
