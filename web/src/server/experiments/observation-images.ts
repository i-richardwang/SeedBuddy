/** Assigns and removes photographs in observation cells. */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  observationOrdinals,
  unitIsAvailableAt,
} from "../../domain/experiments/culture-events";
import {
  ExperimentImageAlreadyUsedError,
  ExperimentObservationImageNotFoundError,
  ImageStorageConflictError,
  ObservationImageAssignmentConflictError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import type {
  ExperimentObservation,
  ObservationImageAssignment,
  ObservationImageAssignmentResult,
  ObservationImageRef,
  ObservationRecord,
} from "../../domain/experiments/schema";
import { lockImage, markImagesUnclear } from "../images/public";
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
  atObservationImage,
  listObservations,
  listUnits,
  lockExperiment,
  requireObservation,
} from "./records";

/** Adds an observation day and matches the photographs taken on it to their units, together. */
export async function recordObservation(
  { images: photos, ...request }: ObservationRecord,
  executor?: Executor,
): Promise<ExperimentObservation> {
  return inTransaction(executor, async (tx) => {
    const observation = await createObservation(request, tx);
    if (photos.length === 0) return observation;
    const assigned = await assignObservationImages(
      {
        experiment: request.experiment,
        observation: observation.id,
        images: photos,
      },
      tx,
    );
    return assigned.observation;
  });
}

export async function assignObservationImages(
  value: ObservationImageAssignment,
  executor?: Executor,
): Promise<ObservationImageAssignmentResult> {
  const {
    experiment: experimentId,
    observation: observationId,
    images: assignments,
  } = value;
  const unitIds = assignments.map((assignment) => assignment.unit);
  if (new Set(unitIds).size !== unitIds.length) {
    throw new ObservationImageAssignmentConflictError(
      "Two images cannot be assigned to the same unit",
    );
  }
  const digests = [
    ...new Set(assignments.map((assignment) => assignment.digest)),
  ].sort();
  if (digests.length !== assignments.length) {
    throw new ObservationImageAssignmentConflictError(
      "The same image is assigned twice",
    );
  }

  return inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const observations = await listObservations(experimentId, tx);
    const observation = requireObservation(observations, observationId);
    const ordinals = observationOrdinals(observations);
    const units = await listUnits(experimentId, tx);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const unknown = unitIds.filter((unit) => !byId.has(unit));
    if (unknown.length > 0) {
      throw new UnitNotFoundError(
        `Units do not belong to this experiment: ${unknown.join(", ")}`,
      );
    }
    const unavailable = unitIds
      .map((unitId) => byId.get(unitId)!)
      .filter((unit) => !unitIsAvailableAt(unit.events, observation, ordinals));
    if (unavailable.length > 0) {
      throw new ObservationImageAssignmentConflictError(
        `Images cannot be assigned to units removed before this observation: ${unavailable.map((unit) => unit.code).join(", ")}`,
      );
    }

    for (const digest of digests) await lockImage(digest, tx);
    const stored = await tx
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, digests));
    if (stored.length !== digests.length) {
      throw new ImageStorageConflictError(
        "Some images are no longer stored; upload them again",
      );
    }

    const filled = await tx
      .select({
        id: experimentObservationImages.id,
      })
      .from(experimentObservationImages)
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          eq(experimentObservationImages.observationId, observationId),
          inArray(experimentObservationImages.unitId, unitIds),
        ),
      );
    if (filled.length > 0) {
      await tx.delete(experimentObservationImages).where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          inArray(
            experimentObservationImages.id,
            filled.map((row) => row.id),
          ),
        ),
      );
    }

    const used = await tx
      .select({
        digest: experimentObservationImages.imageId,
        filename: experimentObservationImages.filename,
        unit: experimentUnits.code,
        observedOn: experimentObservations.observedOn,
      })
      .from(experimentObservationImages)
      .innerJoin(
        experimentUnits,
        and(
          eq(
            experimentUnits.experimentId,
            experimentObservationImages.experimentId,
          ),
          eq(experimentUnits.id, experimentObservationImages.unitId),
        ),
      )
      .innerJoin(experimentObservations, atImageObservation())
      .where(
        and(
          eq(experimentObservationImages.experimentId, experimentId),
          inArray(experimentObservationImages.imageId, digests),
        ),
      );
    if (used.length > 0) {
      throw new ExperimentImageAlreadyUsedError(
        used.map((row) => ({
          digest: row.digest,
          filename: row.filename,
          unit: row.unit,
          observedOn: row.observedOn,
        })),
      );
    }

    await tx.insert(experimentObservationImages).values(
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
    await markImagesUnclear(
      assignments
        .filter((assignment) => assignment.unclear)
        .map((assignment) => assignment.digest),
      tx,
    );
    return {
      observation: requireObservation(
        await listObservations(experimentId, tx),
        observationId,
      ),
      assigned: assignments.length,
    };
  });
}

export async function unassignObservationImage(
  value: ObservationImageRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, observationImage: observationImageId } =
    value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const [row] = await tx
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
  executor?: Executor,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    const [image] = await tx
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
      tx,
    );
  });
}
