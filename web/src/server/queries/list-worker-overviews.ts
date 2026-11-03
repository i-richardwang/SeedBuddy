import { eq } from "drizzle-orm";

import { workerPresence } from "../../domain/workers/presence";
import type { WorkerPresenceDetail } from "../../domain/workers/read-model";
import type { WorkerActivity } from "../../domain/workers/schema";
import { attemptIsActive } from "../inference/public";
import { database } from "../infra/db/client";
import {
  datasetSnapshots,
  datasets,
  inferenceAttempts,
  trainingRuns,
} from "../infra/db/schema";
import {
  leaseIsHeld,
  listEnrolledWorkers,
  listWorkers,
} from "../workers/public";
import { imageFilenames } from "./image-filenames";

/**
 * A held lease belongs to its worker's current session, so each worker's
 * activity is keyed by the worker alone.
 */
async function inferenceActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const rows = await (
    await database()
  )
    .select({
      workerId: inferenceAttempts.workerId,
      digest: inferenceAttempts.imageId,
    })
    .from(inferenceAttempts)
    .where(attemptIsActive(at));
  const filenames = await imageFilenames(rows.map((row) => row.digest));
  return new Map(
    rows.map((row) => [
      row.workerId,
      { kind: "inference", image: filenames.get(row.digest) ?? "an image" },
    ]),
  );
}

async function trainingActivity(
  at: Date,
): Promise<Map<string, WorkerActivity>> {
  const rows = await (
    await database()
  )
    .select({
      workerId: trainingRuns.workerId,
      runId: trainingRuns.id,
      dataset: { id: datasets.id, name: datasets.name },
    })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .innerJoin(datasets, eq(datasets.id, datasetSnapshots.datasetId))
    .where(leaseIsHeld(trainingRuns, at));
  return new Map(
    rows.flatMap((row) =>
      row.workerId
        ? [
            [
              row.workerId,
              { kind: "training", runId: row.runId, dataset: row.dataset },
            ] as const,
          ]
        : [],
    ),
  );
}

/**
 * Every enrolled worker with its latest session: presence, what it is doing,
 * and how long ago it was heard from. A worker that never connected has none.
 */
export async function listWorkerOverviews(): Promise<WorkerPresenceDetail> {
  const at = new Date();
  const age = (timestamp: string) =>
    Math.max(0, Math.floor((at.getTime() - Date.parse(timestamp)) / 1000));
  const [enrolled, sessions, inference, training] = await Promise.all([
    listEnrolledWorkers(),
    listWorkers(),
    inferenceActivity(at),
    trainingActivity(at),
  ]);
  const sessionOf = new Map(
    sessions.map((session) => [session.workerId, session]),
  );
  return {
    workers: enrolled.map((workerId) => {
      const session = sessionOf.get(workerId);
      if (!session) {
        return {
          workerId,
          presence: "offline" as const,
          lastSeenSeconds: null,
          activity: null,
        };
      }
      return {
        workerId,
        presence: workerPresence(session.lastSeenAt, at),
        lastSeenSeconds: age(session.lastSeenAt),
        activity: inference.get(workerId) ?? training.get(workerId) ?? null,
      };
    }),
  };
}
