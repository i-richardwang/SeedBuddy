import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import { database, type Executor, operationTime } from "../infra/db/client";
import { trainingAttempts } from "../infra/db/schema";

export async function finishAttempt(
  run: TrainingRun,
  outcome: Exclude<TrainingAttempt["outcome"], null>,
  db: Executor,
  error: string | null = null,
  suppliedAt?: Date,
) {
  const at = await operationTime(db, suppliedAt);
  await db
    .update(trainingAttempts)
    .set({ outcome, error, finishedAt: at })
    .where(
      and(
        eq(trainingAttempts.runId, run.id),
        eq(trainingAttempts.attempt, run.attempt),
        isNull(trainingAttempts.finishedAt),
      ),
    );
}

export async function listTrainingAttempts(
  runId: string,
  executor?: Executor,
): Promise<TrainingAttempt[]> {
  const rows = await (executor ?? (await database()))
    .select()
    .from(trainingAttempts)
    .where(eq(trainingAttempts.runId, runId))
    .orderBy(desc(trainingAttempts.attempt));
  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}
