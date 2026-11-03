import { workerPresence } from "../../domain/workers/presence";
import type { TrainingWorkerOverview } from "../../domain/workers/read-model";
import { canTrain } from "../../domain/workers/schema";
import { database, type Executor, operationTime } from "../infra/db/client";
import { listEnrolledWorkers, listWorkers } from "../workers/public";

export async function listTrainingWorkerOverviews(
  suppliedAt?: Date,
  db?: Executor,
): Promise<TrainingWorkerOverview[]> {
  db ??= await database();
  const at = await operationTime(db, suppliedAt);
  const [enrolled, sessions] = await Promise.all([
    listEnrolledWorkers(db),
    listWorkers(db),
  ]);
  return enrolled.flatMap((workerId) => {
    const worker = sessions.find((session) => session.workerId === workerId);
    if (worker && !canTrain(worker)) return [];
    return [
      {
        workerId,
        online: !!worker && workerPresence(worker.lastSeenAt, at) === "online",
      },
    ];
  });
}
