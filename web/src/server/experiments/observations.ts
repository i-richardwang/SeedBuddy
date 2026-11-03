import {
  cultureEventIsTerminal,
  observationOrdinals,
} from "../../domain/experiments/culture-events";
import { assertUnitRecordsEndAt } from "./culture-events";
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { inTransaction, type Executor } from "../infra/db/client";
import { experimentObservations } from "../infra/db/schema";
import {
  ObservationNotFoundError,
  ObservationModelHasCountsError,
  ObservationRejectedError,
} from "../../domain/experiments/errors";
import { resolveCountedClasses } from "../../domain/experiments/readings";
import { ModelNotFoundError } from "../../domain/models/errors";
import type { Model } from "../../domain/models/schema";
import type {
  Experiment,
  ExperimentObservation,
  ObservationRef,
  ObservationRequest,
  ObservationUpdate,
} from "../../domain/experiments/schema";
import {
  atObservation,
  listObservations,
  listUnits,
  listManualReadings,
  lockExperiment,
  requireObservation,
} from "./records";
import { readModel } from "../models/public";

function rejectBeforeInoculation(
  experiment: Experiment,
  observedOn: string,
): void {
  if (observedOn < experiment.inoculatedOn) {
    throw new ObservationRejectedError(
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
  if (rows.some((row) => row.id !== exceptObservationId)) {
    throw new ObservationRejectedError(
      `The experiment already has an observation on ${observedOn}`,
    );
  }
}

/** An observation asks a question the registry holds a model for. */
export async function requireModel(
  modelId: string,
  tx: Executor,
): Promise<Model> {
  const model = await readModel(modelId, tx);
  if (!model) throw new ModelNotFoundError(`Unknown model: ${modelId}`);
  return model;
}

export async function addObservation(
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
    if (!row) throw new Error("Observation was not created");
    return requireObservation(await listObservations(experimentId, tx), row.id);
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
      throw new ObservationModelHasCountsError(
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
    if (!row) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
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
    return requireObservation(observations, row.id);
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
      throw new ObservationRejectedError(
        "An observation with images, counts or culture events cannot be deleted",
      );
    }
    const [row] = await tx
      .delete(experimentObservations)
      .where(atObservation(experimentId, observationId))
      .returning({ id: experimentObservations.id });
    if (!row) {
      throw new ObservationNotFoundError(
        `Unknown observation: ${observationId}`,
      );
    }
  });
}
