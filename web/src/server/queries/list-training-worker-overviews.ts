import { workerPresence } from "../../domain/workers/presence";
import type { TrainingWorkerOverview } from "../../domain/workers/read-model";
import { canTrain, takesTrainingFrom } from "../../domain/workers/schema";
import { database, type Executor, operationTime } from "../infra/db/client";
import { listEnrolledWorkers, listWorkers } from "../workers/public";

/**
 * The workers the user may send training to: the shared ones and the user's
 * own. A worker that has connected without the training runtime is left out.
 */
export async function listTrainingWorkerOverviews(
  user: string,
  suppliedAt?: Date,
  db?: Executor,
): Promise<TrainingWorkerOverview[]> {
  db ??= await database();
  const at = await operationTime(db, suppliedAt);
  const [enrolled, sessions] = await Promise.all([
    listEnrolledWorkers(db),
    listWorkers(db),
  ]);
  return enrolled.flatMap(({ workerId, owner }) => {
    if (!takesTrainingFrom(owner?.id ?? null, user)) return [];
    const worker = sessions.find((session) => session.workerId === workerId);
    if (worker && !canTrain(worker)) return [];
    return [
      {
        workerId,
        online: !!worker && workerPresence(worker.lastSeenAt, at) === "online",
        personal: owner !== null,
      },
    ];
  });
}
