import { eq, sql } from "drizzle-orm";

import { TrainingRunConflictError } from "../../domain/training/errors";
import { WorkerOwnerConflictError } from "../../domain/workers/errors";
import { canTrain, takesTrainingFrom } from "../../domain/workers/schema";
import type { Executor } from "../infra/db/client";
import { trainingRuns, workerSessions, workers } from "../infra/db/schema";

/**
 * The worker a run is sent to is enrolled, takes training from the user who
 * sends it, and is able to train.
 */
export async function validateTrainingTarget(
  targetWorkerId: string | null,
  user: string,
  db: Executor,
) {
  if (targetWorkerId === null) return;
  const [worker] = await db
    .select({ ownerId: workers.ownerId, runtimes: workerSessions.runtimes })
    .from(workers)
    .leftJoin(workerSessions, eq(workerSessions.workerId, workers.id))
    .where(eq(workers.id, targetWorkerId));
  if (!worker)
    throw new TrainingRunConflictError(`Unknown worker: ${targetWorkerId}`);
  if (!takesTrainingFrom(worker.ownerId, user))
    throw new WorkerOwnerConflictError(
      `Worker ${targetWorkerId} takes training only from the account it belongs to`,
    );
  if (worker.runtimes && !canTrain({ runtimes: worker.runtimes }))
    throw new TrainingRunConflictError(`Worker ${targetWorkerId} cannot train`);
}

/**
 * Whether a run is the named worker's to claim, by the same rule: a run sent
 * to a worker goes to it while it takes training from the run's sender, so a
 * run does not follow a worker's name to another owner, and a run sent to no
 * worker in particular goes to a shared one.
 */
export function sentToWorker(workerId: string) {
  return sql<boolean>`exists (
    select 1 from ${workers}
    where ${workers.id} = ${workerId}
      and case
        when ${trainingRuns.targetWorkerId} is null
          then ${workers.ownerId} is null
        else ${trainingRuns.targetWorkerId} = ${workerId}
          and (
            ${workers.ownerId} is null
            or ${workers.ownerId} = ${trainingRuns.senderId}
          )
      end
  )`;
}
