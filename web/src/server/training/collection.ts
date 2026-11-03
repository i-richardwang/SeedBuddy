import { eq } from "drizzle-orm";

import { listBlobs, removeBlob } from "../infra/blobs/store";
import { transaction } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import { parseArtifactPartKey } from "./keys";

/** Final-model parts live only while their execution attempt has a live lease. */
export async function collectTrainingArtifactParts(): Promise<string[]> {
  const collected: string[] = [];
  for (const key of await listBlobs("training-artifact-parts/")) {
    const reference = parseArtifactPartKey(key);
    if (!reference) continue;
    await transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(trainingRuns)
        .where(eq(trainingRuns.id, reference.trainingRunId))
        .for("update");
      if (
        run?.status === "running" &&
        run.attempt === reference.trainingAttempt &&
        run.leaseExpiresAt &&
        run.leaseExpiresAt > new Date()
      )
        return;
      await removeBlob(key);
      collected.push(key);
    });
  }
  return collected;
}
