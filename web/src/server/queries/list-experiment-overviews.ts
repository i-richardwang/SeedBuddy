/** Composes experiment grids, unit series, and overview listings. */
import { asc, desc, sql } from "drizzle-orm";

import type { ExperimentOverview } from "../../domain/experiments/read-model";
import { toExperiment } from "../experiments/public";
import { type Executor, snapshot } from "../infra/db/client";
import {
  experimentObservations,
  experiments,
  experimentTreatments,
  experimentUnits,
} from "../infra/db/schema";

export function listExperimentOverviews(): Promise<ExperimentOverview[]> {
  return snapshot(queryExperimentOverviews);
}

/**
 * The outer row's experiment id, qualified: a select from one table writes
 * its columns bare, which inside a subquery would name the inner table's own.
 */
const outerExperimentId = sql`${experiments}.${sql.identifier(experiments.id.name)}`;

/** How many rows of `table` belong to the experiment of the outer row. */
function countOf(
  table:
    | typeof experimentTreatments
    | typeof experimentUnits
    | typeof experimentObservations,
) {
  return sql<number>`(select count(*) from ${table} where ${table.experimentId} = ${outerExperimentId})`.mapWith(
    Number,
  );
}

async function queryExperimentOverviews(
  db: Executor,
): Promise<ExperimentOverview[]> {
  const rows = await db
    .select({
      experiment: experiments,
      treatments: countOf(experimentTreatments),
      units: countOf(experimentUnits),
      observations: countOf(experimentObservations),
      lastObservedOn: sql<
        string | null
      >`(select max(${experimentObservations.observedOn})::text from ${experimentObservations} where ${experimentObservations.experimentId} = ${outerExperimentId})`,
    })
    .from(experiments)
    .orderBy(
      desc(experiments.createdAt),
      asc(experiments.name),
      asc(experiments.id),
    );
  return rows.map((row) => ({
    ...row,
    experiment: toExperiment(row.experiment),
  }));
}
