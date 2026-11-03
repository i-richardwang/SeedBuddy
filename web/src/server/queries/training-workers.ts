import type { TrainingWorkerOption } from "../../domain/training/read-model";
import { workerPresence } from "../../domain/workers/presence";
import { canTrain } from "../../domain/workers/schema";
import { listEnrolledWorkers, listWorkers } from "../workers/public";

export async function trainingWorkerOptions(
  at = new Date(),
): Promise<TrainingWorkerOption[]> {
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
