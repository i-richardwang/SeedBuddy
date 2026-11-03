import type { DetectionResult } from "../../domain/detection/schema";
import type { Worker } from "../../domain/workers/schema";
import {
  type DetectionTarget,
  storeInferenceOutcome,
} from "../inference/outcomes";
import { transaction } from "../infra/db/client";
import { inferenceTasks } from "../infra/db/schema";

/** Seed a successful task and its canonical result without a worker lease. */
export async function seedDetectionResult(
  target: DetectionTarget,
  result: DetectionResult,
  worker: Pick<Worker, "runtimes">,
): Promise<DetectionResult> {
  return transaction(async (tx) => {
    const at = new Date();
    await storeInferenceOutcome(target, result, worker, at, tx);
    await tx
      .insert(inferenceTasks)
      .values({
        imageId: target.digest,
        modelVersionId: target.versionId,
        status: "succeeded",
        createdAt: at,
        availableAt: at,
        finishedAt: at,
      })
      .onConflictDoUpdate({
        target: [inferenceTasks.imageId, inferenceTasks.modelVersionId],
        set: { status: "succeeded", finishedAt: at, error: null },
      });
    return result;
  });
}

/** Seed a terminal task failure, which has no detection document. */
export async function seedInferenceTaskFailure(
  target: DetectionTarget,
  error: string,
): Promise<void> {
  await transaction(async (tx) => {
    const at = new Date();
    await tx.insert(inferenceTasks).values({
      imageId: target.digest,
      modelVersionId: target.versionId,
      status: "failed",
      createdAt: at,
      availableAt: at,
      finishedAt: at,
      error,
    });
  });
}
