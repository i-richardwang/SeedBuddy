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
  return buildModelRecords((kind) => {
    const column = MODEL_RECORD_COLUMNS[kind];
    return db.$count(column.table, eq(column, model));
  });
}

/** How many records of each kind name one model, read at the moment of asking. */
export async function modelRecords(
  model: string,
  db: Executor,
): Promise<ModelRecords> {
  const counts = buildModelRecords((kind) => {
    const column = MODEL_RECORD_COLUMNS[kind];
    return db.$count(column.table, eq(column, model));
  });
  return {
    versions: await counts.versions,
    uploads: await counts.uploads,
    observations: await counts.observations,
    annotations: await counts.annotations,
    datasets: await counts.datasets,
    trainingRuns: await counts.trainingRuns,
  };
}

export function toModelRecords(
  row: Record<ModelRecordKind, unknown>,
): ModelRecords {
  return buildModelRecords((kind) => Number(row[kind]));
}

/** The kinds that hold a model in place, in the order the contract lists them. */
export function heldBy(records: ModelRecords): ModelRecordKind[] {
  return MODEL_RECORD_KINDS.filter((kind) => records[kind] > 0);
}

function buildModelRecords<T>(
  value: (kind: ModelRecordKind) => T,
): Record<ModelRecordKind, T> {
  return {
    versions: value("versions"),
    uploads: value("uploads"),
    observations: value("observations"),
    annotations: value("annotations"),
    datasets: value("datasets"),
    trainingRuns: value("trainingRuns"),
  };
}
