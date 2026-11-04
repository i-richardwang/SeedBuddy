import { eq } from "drizzle-orm";

import { TrainingRunConflictError } from "../../domain/training/errors";
import { canTrain } from "../../domain/workers/schema";
import { database } from "../infra/db/client";
import { workerSessions, workers } from "../infra/db/schema";

export async function validateTrainingTarget(targetWorkerId: string | null) {
  if (targetWorkerId === null) return;
  const [worker] = await (
    await database()
  )
    .select({ runtimes: workerSessions.runtimes })
    .from(workers)
    .leftJoin(workerSessions, eq(workerSessions.workerId, workers.id))
    .where(eq(workers.id, targetWorkerId));
  if (!worker)
    throw new TrainingRunConflictError(`Unknown worker: ${targetWorkerId}`);
  if (worker.runtimes && !canTrain({ runtimes: worker.runtimes }))
    throw new TrainingRunConflictError(`Worker ${targetWorkerId} cannot train`);
}
