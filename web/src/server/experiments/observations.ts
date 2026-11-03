import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { resolveCountedClasses } from "../../domain/experiments/cell-reading";
import {
  cultureEventIsTerminal,
  observationOrdinals,
} from "../../domain/experiments/culture-events";
import {
  ObservationConflictError,
  ObservationModelCountsConflictError,
} from "../../domain/experiments/errors";
import type {
  Experiment,
  ExperimentObservation,
  ObservationRef,
  ObservationRequest,
  ObservationUpdate,
} from "../../domain/experiments/schema";
import { type Executor, inTransaction } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import { requireModel } from "../models/public";
import { assertUnitRecordsEndAt } from "./culture-events";
import {
  atObservation,
  listManualReadings,
  listObservations,
  listUnits,
  lockExperiment,
  requireObservation,
} from "./records";

function rejectBeforeInoculation(
  experiment: Experiment,
  observedOn: string,
): void {
  if (observedOn < experiment.inoculatedOn) {
    throw new ObservationConflictError(
      `An observation cannot precede inoculation on ${experiment.inoculatedOn}`,
    );
  }
}

async function rejectSameDay(
  experimentId: string,
  observedOn: string,
  exceptObservationId: string | null,
  tx: Executor,
): Promise<void> {
  const rows = await tx
    .select({ id: experimentObservations.id })
    .from(experimentObservations)
    .where(
      and(
        eq(experimentObservations.experimentId, experimentId),
        eq(experimentObservations.observedOn, observedOn),
      ),
    );
  if (rows.some((row) => row!.id !== exceptObservationId)) {
    throw new ObservationConflictError(
      `The experiment already has an observation on ${observedOn}`,
    );
  }
}

export async function createObservation(
  value: ObservationRequest,
  executor?: Executor,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observedOn,
    note,
    modelId,
    countedClasses,
  } = value;
  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, null, tx);
    const model = await requireModel(modelId, tx);
    const [row] = await tx
      .insert(experimentObservations)
      .values({
        experimentId,
        id: randomUUID(),
        inoculatedOn: experiment.inoculatedOn,
        observedOn,
        note,
        modelId,
        countedClasses: resolveCountedClasses(model.classes, countedClasses),
        createdAt: new Date(),
      })
      .returning();
    return requireObservation(
      await listObservations(experimentId, tx),
      row!.id,
    );
  });
}

export async function updateObservation(
  value: ObservationUpdate,
  executor?: Executor,
): Promise<ExperimentObservation> {
  const {
    experiment: experimentId,
    observation: observationId,
    observedOn,
    note,
    modelId,
    countedClasses,
  } = value;
  return inTransaction(executor, async (tx) => {
    const experiment = await lockExperiment(experimentId, tx);
    const previous = requireObservation(
      await listObservations(experimentId, tx),
      observationId,
    );
    if (
      previous.modelId !== modelId &&
      (await listManualReadings(experimentId, tx)).some(
        (reading) => reading.observation === observationId,
      )
    ) {
      throw new ObservationModelCountsConflictError(
        "Withdraw the observation's manual counts before changing its model",
      );
    }
    rejectBeforeInoculation(experiment, observedOn);
    await rejectSameDay(experimentId, observedOn, observationId, tx);
    const model = await requireModel(modelId, tx);
    const [row] = await tx
      .update(experimentObservations)
      .set({
        observedOn,
        note,
        modelId,
        countedClasses: resolveCountedClasses(model.classes, countedClasses),
      })
      .where(atObservation(experimentId, observationId))
      .returning();
    const observations = await listObservations(experimentId, tx);
    if (previous.observedOn !== observedOn) {
      const ordinals = observationOrdinals(observations);
      for (const unit of await listUnits(experimentId, tx)) {
        const terminal = unit.events.find((event) =>
          cultureEventIsTerminal(event.type),
        );
        if (terminal)
          await assertUnitRecordsEndAt(
            experimentId,
            unit,
            requireObservation(observations, terminal.observation),
            ordinals,
            tx,
          );
      }
    }
    return requireObservation(observations, row!.id);
  });
}

export async function deleteObservation(
  value: ObservationRef,
  executor?: Executor,
): Promise<void> {
  const { experiment: experimentId, observation: observationId } = value;
  await inTransaction(executor, async (tx) => {
    await lockExperiment(experimentId, tx);
    const observation = requireObservation(
      await listObservations(experimentId, tx),
      observationId,
    );
    if (observation.hasRecords) {
      throw new ObservationConflictError(
        "An observation with images, counts or culture events cannot be deleted",
      );
    }
    await tx
      .delete(experimentObservations)
      .where(atObservation(experimentId, observationId));
  });
}
