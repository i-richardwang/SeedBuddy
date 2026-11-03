import { and, eq, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  annotationReading,
  type ImageReadings,
  type Review,
} from "../../domain/annotation/readings";
import type { AnnotationDocument, AnnotationRef } from "../../domain/annotation/schema";
import { AnnotationRunNotFoundError } from "../../domain/annotation-runs/errors";
import type { AnnotationProgress, AnnotationProposal } from "../../domain/annotation-runs/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { shownDetectingVersion } from "../inference/public";
import { database, type Executor } from "../infra/db/client";
import {
  annotationRuns,
  annotations,
  images,
  inferenceOutcomes,
} from "../infra/db/schema";

/** Callers choose the detection version; reviews and proposals belong to the model. */
export function readingsSubquery(db: Executor, {
  modelId, version,
}: { modelId: SQLWrapper | string; version: SQLWrapper }) {
  const proposal = alias(annotationRuns, "proposal_runs");
  const active = alias(annotationRuns, "active_runs");
  return db.select({
    imageId: images.id,
    detection: sql<DetectionResult | null>`${inferenceOutcomes.document}`.as("reading_detection"),
    annotation: sql<AnnotationDocument | null>`${annotations.document}`.as("reading_annotation"),
    proposal: sql<AnnotationProposal | null>`case when ${proposal.result} is null then null else ${proposal.result}::jsonb || jsonb_build_object('createdAt', to_char(${proposal.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end`.as("reading_proposal"),
    progress: sql<AnnotationProgress | null>`case when ${active.id} is null then null else jsonb_build_object('completed', ${active.completed}, 'total', ${active.total}) end`.as("reading_progress"),
  }).from(images)
    .leftJoin(annotations, and(eq(annotations.imageId, images.id), eq(annotations.modelId, modelId)))
    .leftJoin(inferenceOutcomes, and(eq(inferenceOutcomes.imageId, images.id), eq(inferenceOutcomes.modelVersionId, version)))
    .leftJoin(proposal, eq(proposal.id, sql`(select r.id from annotation_runs r where r.image_id = ${images.id} and r.model_id = ${modelId} and r.status = 'succeeded' order by r.created_at desc, r.id desc limit 1)`))
    .leftJoin(active, and(eq(active.imageId, images.id), eq(active.modelId, modelId), eq(active.status, "running")))
    .as("readings");
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
  const readings = readingsSubquery(db, {
    modelId: ref.modelId,
    version: shownDetectingVersion(images.id, ref.modelId),
  });
  const [row] = await db.select({
    width: images.width, height: images.height,
    detection: readings.detection, annotation: readings.annotation,
    proposal: readings.proposal, progress: readings.progress,
  }).from(images).leftJoinLateral(readings, eq(readings.imageId, images.id))
    .where(eq(images.id, ref.digest));
  if (!row) return null;
  return {
    ref,
    width: row.width,
    height: row.height,
    detection: row.detection,
    proposal: row.proposal,
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
