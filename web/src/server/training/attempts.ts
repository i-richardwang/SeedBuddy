import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import type { Executor } from "../infra/db/client";
import { trainingAttempts } from "../infra/db/schema";

export async function finishAttempt(
  run: TrainingRun,
  outcome: Exclude<TrainingAttempt["outcome"], null>,
  error: string | null,
  at: Date,
  db: Executor,
) {
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
  db: Executor,
): Promise<TrainingAttempt[]> {
  const rows = await db
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
