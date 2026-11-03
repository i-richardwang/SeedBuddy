import { and, asc, eq } from "drizzle-orm";

import {
  type TrainingEpoch,
  type TrainingEpochReport,
  trainingEpochSchema,
} from "../../domain/training/schema";
import { database, type Executor } from "../infra/db/client";
import { trainingEpochs, trainingRuns } from "../infra/db/schema";

type EpochRow = typeof trainingEpochs.$inferSelect;

function toEpoch(row: EpochRow): TrainingEpoch {
  return trainingEpochSchema.parse({
    epoch: row.epoch,
    recordedAt: row.recordedAt.toISOString(),
    train: {
      box: row.trainBoxLoss,
      classification: row.trainClassificationLoss,
      regression: row.trainRegressionLoss,
    },
    val: {
      box: row.valBoxLoss,
      classification: row.valClassificationLoss,
      regression: row.valRegressionLoss,
    },
    precision: row.precision,
    recall: row.recall,
    map50: row.map50,
    map50To95: row.map50To95,
    fitness: row.fitness,
    learningRate: row.learningRate,
  });
}

function epochColumns(report: TrainingEpochReport, recordedAt: Date) {
  return {
    recordedAt,
    trainBoxLoss: report.train.box,
    trainClassificationLoss: report.train.classification,
    trainRegressionLoss: report.train.regression,
    valBoxLoss: report.val.box,
    valClassificationLoss: report.val.classification,
    valRegressionLoss: report.val.regression,
    precision: report.precision,
    recall: report.recall,
    map50: report.map50,
    map50To95: report.map50To95,
    fitness: report.fitness,
    learningRate: report.learningRate,
  };
}

export async function saveTrainingEpoch(
  runId: string,
  attempt: number,
  report: TrainingEpochReport,
  at: Date,
  tx: Executor,
): Promise<void> {
  const columns = epochColumns(report, at);
  await tx
    .insert(trainingEpochs)
    .values({ runId, attempt, epoch: report.epoch, ...columns })
    .onConflictDoUpdate({
      target: [
        trainingEpochs.runId,
        trainingEpochs.attempt,
        trainingEpochs.epoch,
      ],
      set: columns,
    });
}

/**
 * The run's curve: the epochs of its current attempt. An attempt that resumes
 * reports again the epochs it carries forward; an abandoned attempt's are not
 * the run's.
 */
export async function listTrainingEpochs(
  runId: string,
): Promise<TrainingEpoch[]> {
  const db = await database();
  const rows = await db
    .select({ epoch: trainingEpochs })
    .from(trainingEpochs)
    .innerJoin(
      trainingRuns,
      and(
        eq(trainingRuns.id, trainingEpochs.runId),
        eq(trainingRuns.attempt, trainingEpochs.attempt),
      ),
    )
    .where(eq(trainingEpochs.runId, runId))
    .orderBy(asc(trainingEpochs.epoch));
  return rows.map(({ epoch }) => toEpoch(epoch));
}
