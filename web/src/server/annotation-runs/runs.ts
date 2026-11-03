import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { sourceInstances } from "../../domain/annotation/readings";
import {
  type AnnotationRef,
  annotationSchema,
  type ReviewSource,
} from "../../domain/annotation/schema";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import {
  type AnnotationProgress,
  annotationDefinitionSchema,
  type StartAnnotationRun,
} from "../../domain/annotation-runs/schema";
import { regions } from "../../domain/annotation-runs/tasks";
import type { ImageRectangle } from "../../domain/images/geometry";
import { assertInstanceClasses } from "../../domain/models/classes";
import {
  lockImage,
  requireStoredImage,
  resolveDishCoverage,
} from "../images/public";
import { type Executor, operationTime, transaction } from "../infra/db/client";
import { annotationRuns, annotationTasks } from "../infra/db/schema";
import { requireModel } from "../models/public";
import { readReadings } from "../readings/public";

/** The image's run in progress for the model, of which there is at most one. */
export const inProgress = (ref: AnnotationRef) =>
  and(
    eq(annotationRuns.imageId, ref.digest),
    eq(annotationRuns.modelId, ref.modelId),
    eq(annotationRuns.status, "running"),
  );

/**
 * Starts the image's run with its definition and regions frozen. It stays
 * open until every region is accepted or it is cancelled, and any connected
 * agent continues it.
 */
export async function createAnnotationRun(
  request: StartAnnotationRun,
): Promise<{ id: string; progress: AnnotationProgress }> {
  return transaction(async (db) => {
    await lockImage(request.ref.digest, db);
    const [active] = await db
      .select()
      .from(annotationRuns)
      .where(inProgress(request.ref));
    if (active)
      throw new AnnotationRunConflictError(
        `This image already has an AI annotation run in progress (${active.completed}/${active.total} regions)`,
      );
    const { definition, fallback } = await freezeDefinition(request, db);
    const tasks = regions(definition);
    if (!tasks.length)
      throw new AnnotationRunConflictError("The scope touches no region");
    if (tasks.length > 4096)
      throw new AnnotationRunConflictError(
        "Annotation requires too many regions; increase the model's core size",
      );
    const id = randomUUID();
    const now = await operationTime(db);
    await db.insert(annotationRuns).values({
      id,
      imageId: request.ref.digest,
      modelId: request.ref.modelId,
      definition,
      status: "running",
      total: tasks.length,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < tasks.length; i += 1000) {
      await db.insert(annotationTasks).values(
        tasks.slice(i, i + 1000).map((region) => ({
          runId: id,
          taskId: `${id}/${region.id}`,
          region,
        })),
      );
    }
    if (fallback)
      console.info(
        `${JSON.stringify({
          event: "annotation-run.full-image-coverage",
          runId: id,
          imageId: request.ref.digest,
          reason: fallback,
        })}\n`,
      );
    return { id, progress: { completed: 0, total: tasks.length } };
  });
}

/** Freeze a reading's boxes and, for an AI proposal, which await confirmation. */
async function readingInput(
  ref: AnnotationRef,
  source: ReviewSource,
  db: Executor,
) {
  const readings = await readReadings(ref, db);
  const instances = readings && sourceInstances(readings, source);
  if (!instances)
    throw new AnnotationRunConflictError(
      `The image has no ${source} to begin from`,
    );
  return {
    input: instances,
    inputUncertainIds:
      source === "proposal" && readings?.proposal
        ? readings.proposal.uncertainIds
        : [],
  };
}

/**
 * The request's definition as the image, its readings and its model stand
 * now, with why a dish run covers the whole image when it does.
 */
async function freezeDefinition(request: StartAnnotationRun, db: Executor) {
  const image = await requireStoredImage(request.ref.digest, db);
  const model = await requireModel(request.ref.modelId, db);
  const frame = { digest: image.id, width: image.width, height: image.height };
  const initial =
    typeof request.input === "string"
      ? await readingInput(request.ref, request.input, db)
      : { input: request.input, inputUncertainIds: [] };
  const { input } = initial;
  if (input) {
    annotationSchema.parse({
      schemaVersion: 1,
      image: frame,
      instances: input,
    });
    assertInstanceClasses(model.classes, input, "AI annotation input");
  }
  if (request.scope) {
    if (!input)
      throw new AnnotationRunConflictError(
        "Redrawing part of the image needs the boxes to keep; pass input",
      );
    const inside = (b: ImageRectangle) =>
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.width <= image.width &&
      b.y + b.height <= image.height;
    if (!request.scope.every(inside))
      throw new AnnotationRunConflictError("Scope exceeds image bounds");
  }
  const { instructions, ...region } = model.annotation;
  if (!instructions)
    throw new AnnotationRunConflictError(
      "The model has no annotation instructions; add them on the Models page",
    );
  const dish = region.area === "dish" ? resolveDishCoverage(image) : null;
  const definition = annotationDefinitionSchema.parse({
    image: frame,
    coverage: dish?.coverage ?? null,
    ...initial,
    scope: request.scope,
    config: { classes: model.classes, rules: instructions, ...region },
  });
  return { definition, fallback: dish?.fallback ?? null };
}

/**
 * Gives up the image's run in progress and its accepted regions, so another
 * can start with different input or scope.
 */
export async function cancelAnnotationRun(ref: AnnotationRef): Promise<void> {
  return transaction(async (db) => {
    const [cancelled] = await db
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: await operationTime(db) })
      .where(inProgress(ref))
      .returning({ id: annotationRuns.id });
    if (!cancelled)
      throw new AnnotationRunConflictError(
        "No AI annotation run is in progress for this image",
      );
  });
}
