import { workerPresence } from "../../domain/workers/presence";
import type { TrainingWorkerOverview } from "../../domain/workers/read-model";
import { canTrain } from "../../domain/workers/schema";
import { listEnrolledWorkers, listWorkers } from "../workers/public";

export async function listTrainingWorkerOverviews(
  at = new Date(),
): Promise<TrainingWorkerOverview[]> {
  const [enrolled, sessions] = await Promise.all([
    listEnrolledWorkers(),
    listWorkers(),
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
