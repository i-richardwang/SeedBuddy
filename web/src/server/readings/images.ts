import { and, eq, exists, type SQLWrapper, sql } from "drizzle-orm";
import { alias, type PgSelect } from "drizzle-orm/pg-core";

import {
  annotationReading,
  type ImageReadings,
  type Review,
} from "../../domain/annotation/readings";
import type {
  AnnotationDocument,
  AnnotationRef,
} from "../../domain/annotation/schema";
import type {
  AnnotationProgress,
  AnnotationProposal,
} from "../../domain/annotation-runs/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { ImageNotFoundError } from "../../domain/images/errors";
import type { Tally } from "../../domain/models/classes";
import { shownDetectingVersion } from "../inference/public";
import { database, type Executor } from "../infra/db/client";
import {
  annotationRuns,
  annotations,
  images,
  inferenceOutcomes,
} from "../infra/db/schema";

/*
 * The subqueries below read their table under a name of their own, so a
 * column of the same table in the caller's query is never taken for theirs.
 */

/**
 * The run whose result is the image's proposal for the model: the newest
 * that succeeded. A proposal belongs to the model, not to a version.
 */
function proposalRunId(imageId: SQLWrapper, modelId: SQLWrapper | string) {
  const run = alias(annotationRuns, "proposal_run");
  return sql<
    string | null
  >`(select ${run.id} from ${annotationRuns} as ${run} where ${run.imageId} = ${imageId} and ${run.modelId} = ${modelId} and ${run.status} = 'succeeded' order by ${run.createdAt} desc, ${run.id} desc limit 1)`;
}

/**
 * Whether the image has a proposal for the model: a run on it succeeded.
 * A condition, for a query that asks it of many images at once.
 */
export function hasProposal(imageId: SQLWrapper, modelId: SQLWrapper) {
  const run = alias(annotationRuns, "proposal_run");
  return exists(
    sql`(select 1 from ${annotationRuns} as ${run} where ${run.imageId} = ${imageId} and ${run.modelId} = ${modelId} and ${run.status} = 'succeeded')`,
  );
}

/**
 * Whether the version has detected the image. A condition, for a query that
 * asks it of many images at once.
 */
export function hasDetection(imageId: SQLWrapper, version: SQLWrapper) {
  const outcome = alias(inferenceOutcomes, "detected_outcome");
  return exists(
    sql`(select 1 from ${inferenceOutcomes} as ${outcome} where ${outcome.imageId} = ${imageId} and ${outcome.modelVersionId} = ${version})`,
  );
}

/**
 * The readings of an image for a model, joined to the caller's query, which
 * names the image and the model on each of its rows: the agent's proposal and
 * the reviewer's annotation, which belong to the model, and the progress of a
 * run still at work. Each reading comes with its tally, stored beside its
 * document, for callers that count rather than draw, and `proposed` says
 * whether a proposal stands at all, as `hasProposal` asks it. The readings
 * are plain joins, so a query over a page of photographs looks each one up
 * and one over a whole experiment reads them in bulk; a query joins one set
 * of them.
 */
export function imageReadings({
  imageId,
  modelId,
}: {
  imageId: SQLWrapper;
  modelId: SQLWrapper | string;
}) {
  const annotation = alias(annotations, "reading_annotations");
  const proposal = alias(annotationRuns, "reading_proposals");
  const active = alias(annotationRuns, "reading_runs");
  return {
    annotation: sql<AnnotationDocument | null>`${annotation.document}`,
    proposed: sql<boolean>`${proposal.id} is not null`,
    proposal: sql<AnnotationProposal | null>`case when ${proposal.result} is null then null else ${proposal.result} || jsonb_build_object('createdAt', to_char(${proposal.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end`,
    proposalDocument: sql<AnnotationDocument | null>`${proposal.result}->'document'`,
    proposalTally: sql<Tally | null>`${proposal.tally}`,
    annotationTally: sql<Tally | null>`${annotation.tally}`,
    progress: sql<AnnotationProgress | null>`case when ${active.id} is null then null else jsonb_build_object('completed', ${active.completed}, 'total', ${active.total}) end`,
    /** Joins the readings to `query`, whose rows name the image and the model. */
    join<Query extends PgSelect>(query: Query) {
      return query
        .leftJoin(
          annotation,
          and(eq(annotation.imageId, imageId), eq(annotation.modelId, modelId)),
        )
        .leftJoin(proposal, eq(proposal.id, proposalRunId(imageId, modelId)))
        .leftJoin(
          active,
          and(
            eq(active.imageId, imageId),
            eq(active.modelId, modelId),
            eq(active.status, "running"),
          ),
        );
    },
  };
}

/** The readings of an image, as `imageReadings` joins them. */
export type JoinedReadings = ReturnType<typeof imageReadings>;

/**
 * The detection of an image by the version the caller chooses, joined to the
 * caller's query, which names the image and the version on each of its rows,
 * with its tally; `detected` says whether the version has detected the image,
 * as `hasDetection` asks it. A detection belongs to a version, not to the
 * model; a query joins one of them.
 */
export function imageDetection({
  imageId,
  version,
}: {
  imageId: SQLWrapper;
  version: SQLWrapper;
}) {
  const detection = alias(inferenceOutcomes, "reading_detections");
  return {
    detected: sql<boolean>`${detection.imageId} is not null`,
    detection: sql<DetectionResult | null>`${detection.document}`,
    detectionTally: sql<Tally | null>`${detection.tally}`,
    /** Joins the detection to `query`, whose rows name the image and the version. */
    join<Query extends PgSelect>(query: Query) {
      return query.leftJoin(
        detection,
        and(
          eq(detection.imageId, imageId),
          eq(detection.modelVersionId, version),
        ),
      );
    },
  };
}

/** The readings as an agent consults them before redrawing part of the image. */
export async function readAnnotationReading(ref: AnnotationRef) {
  const readings = await readReadings(ref, await database());
  if (!readings) throw new ImageNotFoundError("Image not found");
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
  const readings = imageReadings({ imageId: images.id, modelId: ref.modelId });
  const detection = imageDetection({
    imageId: images.id,
    version: shownDetectingVersion(images.id, ref.modelId),
  });
  const [row] = await detection
    .join(
      readings.join(
        db
          .select({
            width: images.width,
            height: images.height,
            detection: detection.detection,
            annotation: readings.annotation,
            proposal: readings.proposal,
            progress: readings.progress,
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
