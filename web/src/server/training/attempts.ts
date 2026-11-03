import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import { database, type Executor } from "../infra/db/client";
import { trainingAttempts } from "../infra/db/schema";

export async function finishAttempt(
  run: TrainingRun,
  outcome: Exclude<TrainingAttempt["outcome"], null>,
  db: Executor,
  error: string | null = null,
) {
  await db
    .update(trainingAttempts)
    .set({ outcome, error, finishedAt: new Date() })
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
): Promise<TrainingAttempt[]> {
  const rows = await (
    await database()
  )
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
