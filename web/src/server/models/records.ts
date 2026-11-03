import { eq, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import {
  MODEL_RECORD_KINDS,
  type ModelRecordKind,
  type ModelRecords,
} from "../../domain/models/contracts";
import type { Executor } from "../infra/db/client";
import {
  annotations,
  datasets,
  experimentObservations,
  modelUploads,
  modelVersions,
  trainingRuns,
} from "../infra/db/schema";

/**
 * Where each kind of record names its model. Every kind the contract declares
 * has a column here, so a table that starts referring to models is counted by
 * the catalogue and refused by a withdrawal in the same change.
 */
const MODEL_RECORD_COLUMNS: Record<ModelRecordKind, PgColumn> = {
  versions: modelVersions.modelId,
  uploads: modelUploads.modelId,
  observations: experimentObservations.modelId,
  annotations: annotations.modelId,
  datasets: datasets.modelId,
  trainingRuns: trainingRuns.modelId,
};

/**
 * How many records of each kind name the model, as correlated subqueries: one
 * row of a select over `models` carries its own counts.
 */
export function modelRecordCounts(
  db: Executor,
  model: SQLWrapper,
): Record<ModelRecordKind, SQL<number>> {
  const counts = {} as Record<ModelRecordKind, SQL<number>>;
  for (const kind of MODEL_RECORD_KINDS) {
    const column = MODEL_RECORD_COLUMNS[kind];
    counts[kind] = db.$count(column.table, eq(column, model)) as SQL<number>;
  }
  return counts;
}

/** How many records of each kind name one model, read at the moment of asking. */
export async function modelRecords(
  model: string,
  db: Executor,
): Promise<ModelRecords> {
  const records = {} as ModelRecords;
  for (const kind of MODEL_RECORD_KINDS) {
    const column = MODEL_RECORD_COLUMNS[kind];
    records[kind] = await db.$count(column.table, eq(column, model));
  }
  return records;
}

export function toModelRecords(
  row: Record<ModelRecordKind, unknown>,
): ModelRecords {
  const records = {} as ModelRecords;
  for (const kind of MODEL_RECORD_KINDS) records[kind] = Number(row[kind]);
  return records;
}

/** The kinds that hold a model in place, in the order the contract lists them. */
export function heldBy(records: ModelRecords): ModelRecordKind[] {
  return MODEL_RECORD_KINDS.filter((kind) => records[kind] > 0);
}
