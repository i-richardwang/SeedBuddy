import { TrainingRunConflictError } from "../../domain/training/errors";
import { canTrain } from "../../domain/workers/schema";
import { listEnrolledWorkers, listWorkers } from "../workers/public";

export async function validateTrainingTarget(targetWorkerId: string | null) {
  if (
    targetWorkerId !== null &&
    !(await listEnrolledWorkers()).includes(targetWorkerId)
  ) {
    throw new TrainingRunConflictError(`Unknown worker: ${targetWorkerId}`);
  }
  const worker = (await listWorkers()).find(
    (worker) => worker.workerId === targetWorkerId,
  );
  if (worker && !canTrain(worker)) {
    throw new TrainingRunConflictError(`Worker ${targetWorkerId} cannot train`);
  }
}
