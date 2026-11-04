import { eq } from "drizzle-orm";

import { listBlobs, removeBlob } from "../infra/blobs/store";
import { operationTime, transaction } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import { leaseIsHeld } from "../workers/public";
import { parseArtifactPartKey } from "./keys";

/** Final-model parts live only while their execution attempt has a live lease. */
export async function collectTrainingArtifactParts(): Promise<string[]> {
  const collected: string[] = [];
  for (const key of await listBlobs("training-artifact-parts/")) {
    const reference = parseArtifactPartKey(key);
    if (!reference) continue;
    await transaction(async (db) => {
      const at = await operationTime(db);
      const [run] = await db
        .select({
          attempt: trainingRuns.attempt,
          held: leaseIsHeld(trainingRuns, at),
        })
        .from(trainingRuns)
        .where(eq(trainingRuns.id, reference.trainingRunId))
        .for("update");
      if (run?.held && run.attempt === reference.trainingAttempt) return;
      await removeBlob(key);
      collected.push(key);
    });
  }
  return collected;
}
