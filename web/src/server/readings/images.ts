import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AnnotationProposal } from "../../domain/annotation-runs/schema";
import {
  annotationRuns,
  images,
  inferenceOutcomes,
  annotations,
} from "../infra/db/schema";
import { database, type Executor } from "../infra/db/client";
import {
  annotationReading,
  type ImageReadings,
  type Review,
} from "../../domain/annotation/readings";
import type { AnnotationRef } from "../../domain/annotation/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { AnnotationRunNotFoundError } from "../../domain/annotation-runs/errors";
import { shownDetectingVersion } from "../inference/public";

type Row = typeof annotationRuns.$inferSelect;

export const proposalRuns = alias(annotationRuns, "proposal_runs");
export const activeRuns = alias(annotationRuns, "active_runs");

/** Joins the image's run in progress for the model, of which there is at most one. */
export const atActiveRun = (
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) =>
  and(
    eq(activeRuns.imageId, imageId),
    eq(activeRuns.modelId, modelId),
    eq(activeRuns.status, "running"),
  );

/** The newest run that succeeded for the image and model: its AI proposal. */
export function proposalRunId(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return sql`(
    select r.id
    from annotation_runs r
    where r.image_id = ${imageId}
      and r.model_id = ${modelId}
      and r.status = 'succeeded'
    order by r.created_at desc, r.id desc
    limit 1
  )`;
}

function toProposal(row: Row | null): AnnotationProposal | null {
  if (!row?.result) return null;
  return {
    ...row.result,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The readings as an agent consults them before redrawing part of the image. */
export async function readAnnotationReading(ref: AnnotationRef) {
  const readings = await readReadings(ref, await database());
  if (!readings) throw new AnnotationRunNotFoundError("Image not found");
  return annotationReading(readings);
}

/**
 * The review joins each reading on its own: the detection of the current
 * version, or of the newest that has detected the image while the current one
 * has not, the newest agent run that succeeded,
 * and the stored annotation, with the progress of a run still at work.
 */
export async function readReadings(
  ref: AnnotationRef,
  db: Executor,
): Promise<ImageReadings | null> {
  const shown = shownDetectingVersion(images.id, ref.modelId);
  const [row] = await db
    .select({
      width: images.width,
      height: images.height,
      detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`,
      annotation: annotations.document,
      proposal: proposalRuns,
      progress: {
        completed: activeRuns.completed,
        total: activeRuns.total,
      },
    })
    .from(images)
    .leftJoin(
      annotations,
      and(
        eq(annotations.imageId, images.id),
        eq(annotations.modelId, ref.modelId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, images.id),
        eq(inferenceOutcomes.modelVersionId, shown),
      ),
    )
    .leftJoin(
      proposalRuns,
      eq(proposalRuns.id, proposalRunId(images.id, ref.modelId)),
    )
    .leftJoin(activeRuns, atActiveRun(images.id, ref.modelId))
    .where(eq(images.id, ref.digest));
  if (!row) return null;
  return {
    ref,
    width: row.width,
    height: row.height,
    detection: row.detection,
    proposal: toProposal(row.proposal),
    annotation: row.annotation,
    progress: row.progress,
  };
}

/**
 * Images carry no name of their own, so the page names the file as it knows
 * it; the readings are the same wherever the image is shown.
 */
export async function readReview(
  ref: AnnotationRef,
  filename: string,
  db: Executor,
): Promise<Review | null> {
  const readings = await readReadings(ref, db);
  return readings && { ...readings, filename };
}
