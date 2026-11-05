/** Assigns and removes photographs in observation cells. */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { unitIsOnBench } from "../../domain/experiments/culture-events";
import {
  ExperimentObservationImageConflictError,
  ExperimentObservationImageNotFoundError,
  ImageStorageConflictError,
  ObservationImageConflictError,
} from "../../domain/experiments/errors";
import type {
  ExperimentObservation,
  ObservationImageAssignment,
  ObservationImageAssignmentResult,
  ObservationImageRef,
  ObservationRecord,
} from "../../domain/experiments/schema";
import { insertUnclearImages, lockImage } from "../images/public";
import { currentVersion, retryInferenceTask } from "../inference/public";
import { type Executor, inTransaction } from "../infra/db/client";
import {
  experimentObservationImages,
  experimentObservations,
  experimentUnits,
  images,
} from "../infra/db/schema";
import { createObservation } from "./observations";
import {
  atImageObservation,
  atImageUnit,
  atObservationImage,
  listObservations,
  lockExperiment,
  requireObservation,
  requireUnits,
} from "./records";

/** Adds an observation day and matches the photographs taken on it to their units, together. */
export async function recordObservation(
  { images: photos, ...request }: ObservationRecord,
  db?: Executor,
): Promise<ExperimentObservation> {
  return inTransaction(db, async (db) => {
    const observation = await createObservation(request, db);
    if (photos.length === 0) return observation;
    const assigned = await assignObservationImages(
      {
        experiment: request.experiment,
        observation: observation.id,
        images: photos,
      },
      db,
    );
    return assigned.observation;
  });
}

export async function assignObservationImages(
  value: ObservationImageAssignment,
  db?: Executor,
): Promise<ObservationImageAssignmentResult> {
  const {
    experiment: experimentId,
    observation: observationId,
    images: assignments,
  } = value;
  const unitIds = assignments.map((assignment) => assignment.unit);
  if (new Set(unitIds).size !== unitIds.length) {
    throw new ObservationImageConflictError(
      "Two images cannot be assigned to the same unit",
    );
  }
  const digests = [
    ...new Set(assignments.map((assignment) => assignment.digest)),
  ].sort();
  if (digests.length !== assignments.length) {
    throw new ObservationImageConflictError("The same image is assigned twice");
  }

  return inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const observations = await listObservations(experimentId, db);
    const observation = requireObservation(observations, observationId);
    const units = await requireUnits(experimentId, unitIds, db);
    const unavailable = units.filter(
      (unit) => !unitIsOnBench(unit.events, observations, observation),
    );
    if (unavailable.length > 0) {
      throw new ObservationImageConflictError(
        `Images cannot be assigned to units that left the bench before this observation: ${unavailable.map((unit) => unit.code).join(", ")}`,
      );
    }

    for (const digest of digests) await lockImage(digest, db);
    const stored = await db
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, digests));
    if (stored.length !== digests.length) {
      throw new ImageStorageConflictError(
        "Some images are no longer stored; upload them again",
      );
    }

    await db
      .delete(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.observationId, observationId),
          inArray(experimentObservationImages.unitId, unitIds),
        ),
      );

    const used = await db
      .select({
        digest: experimentObservationImages.imageId,
        filename: experimentObservationImages.filename,
        unit: experimentUnits.code,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentObservationImages)
      .innerJoin(experimentUnits, atImageUnit())
      .innerJoin(experimentObservations, atImageObservation())
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          inArray(experimentObservationImages.imageId, digests),
        ),
      );
    if (used.length > 0) {
      throw new ExperimentObservationImageConflictError(
        used.map((row) => ({
          digest: row.digest,
          filename: row.filename,
          unit: row.unit,
          observedOn: row.observedOn,
        })),
      );
    }

    await db.insert(experimentObservationImages).values(
      assignments.map((assignment) => ({
        experimentId,
        id: randomUUID(),
        unitId: assignment.unit,
        observationId,
        imageId: assignment.digest,
        filename: assignment.filename,
      })),
    );
    // A photograph known to be unclear is marked in the same step that
    // places it; the mark is the image's, so it stays if the image moves.
    await insertUnclearImages(
      assignments
        .filter((assignment) => assignment.unclear)
        .map((assignment) => assignment.digest),
      db,
    );
    return {
      observation: requireObservation(
        await listObservations(experimentId, db),
        observationId,
      ),
      assigned: assignments.length,
    };
  });
}

export async function unassignObservationImage(
  value: ObservationImageRef,
  db?: Executor,
): Promise<void> {
  const { experiment: experimentId, observationImage: observationImageId } =
    value;
  await inTransaction(db, async (db) => {
    await lockExperiment(experimentId, db);
    const [row] = await db
      .delete(experimentObservationImages)
      .where(atObservationImage(experimentId, observationImageId))
      .returning({ id: experimentObservationImages.id });
    if (!row) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${observationImageId}`,
      );
    }
  });
}

export async function retryObservationImageAnalysis(
  ref: ObservationImageRef,
  db?: Executor,
): Promise<void> {
  await inTransaction(db, async (db) => {
    const [image] = await db
      .select({
        digest: experimentObservationImages.imageId,
        versionId: currentVersion(experimentObservations.modelId).mapWith(
          String,
        ),
      })
      .from(experimentObservationImages)
      .innerJoin(experimentObservations, atImageObservation())
      .where(atObservationImage(ref.experiment, ref.observationImage));
    if (!image) {
      throw new ExperimentObservationImageNotFoundError(
        `Unknown observation image: ${ref.observationImage}`,
      );
    }
    if (!image.versionId) return;
    await retryInferenceTask(
      {
        digest: image.digest,
        versionId: image.versionId,
      },
      db,
    );
  });
}
