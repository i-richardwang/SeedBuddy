import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { alias, type PgSelect } from "drizzle-orm/pg-core";

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
  type Readings,
  type Review,
} from "../../domain/annotation/review";
import type { AnnotationRef } from "../../domain/annotation/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { AnnotationRunNotFoundError } from "../../domain/annotation-runs/errors";
import { shownDetectingVersion } from "../inference/public";

type Row = typeof annotationRuns.$inferSelect;

const proposalRuns = alias(annotationRuns, "proposal_runs");
const activeRuns = alias(annotationRuns, "active_runs");

/** Joins the image's run in progress for the model, of which there is at most one. */
const atActiveRun = (imageId: SQLWrapper, modelId: SQLWrapper | string) =>
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

/** The active reading can be joined alone when listing unfinished annotation work. */
export function activeReadingJoin(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return {
    run: activeRuns,
    apply: <T extends PgSelect>(query: T) =>
      query.leftJoin(activeRuns, atActiveRun(imageId, modelId)),
  };
}

/** Callers choose the detection version; reviews and proposals belong to the model. */
export function readingsJoin({
  imageId,
  modelId,
  version,
}: {
  imageId: SQLWrapper;
  modelId: SQLWrapper | string;
  version: SQLWrapper;
}) {
  return {
    proposal: proposalRuns,
    apply: <T extends PgSelect>(query: T) =>
      query
        .leftJoin(
          annotations,
          and(
            eq(annotations.imageId, imageId),
            eq(annotations.modelId, modelId),
          ),
        )
        .leftJoin(
          inferenceOutcomes,
          and(
            eq(inferenceOutcomes.imageId, imageId),
            eq(inferenceOutcomes.modelVersionId, version),
          ),
        )
        .leftJoin(
          proposalRuns,
          eq(proposalRuns.id, proposalRunId(imageId, modelId)),
        ),
  };
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
): Promise<Readings | null> {
  const readings = readingsJoin({
    imageId: images.id,
    modelId: ref.modelId,
    version: shownDetectingVersion(images.id, ref.modelId),
  });
  const active = activeReadingJoin(images.id, ref.modelId);
  const [row] = await active
    .apply(
      readings.apply(
        db
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
          .$dynamic(),
      ),
    )
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
