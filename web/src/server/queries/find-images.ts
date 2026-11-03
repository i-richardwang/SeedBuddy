import { and, eq, or, type SQLWrapper, sql } from "drizzle-orm";

import { datasetIdSchema } from "../../domain/datasets/schema";
import {
  experimentIdSchema,
  observationIdSchema,
  unitIdSchema,
} from "../../domain/experiments/schema";
import type {
  ImagePlace,
  ImageSearchOverview,
} from "../../domain/images/read-model";
import { imageDigestSchema } from "../../domain/images/schema";
import { atImageObservation } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import {
  datasetImages,
  datasets,
  experimentObservationImages,
  experimentObservations,
  experiments,
  experimentUnits,
} from "../infra/db/schema";

type Wanted =
  | { kind: "filename"; name: string }
  | { kind: "unit"; experiment: string; unit: string; observation?: string }
  | { kind: "dataset"; dataset: string; digest: string };

/**
 * What a person names an image by: a link to the page showing it, or else
 * its filename, with or without its extension.
 */
function wanted(image: string): Wanted | null {
  const text = image.trim();
  const link = /^(?:[a-z]+:\/\/[^/]*)?(\/[^?#\s]*)(?:\?([^#\s]*))?/i.exec(text);
  const segments = link?.[1]?.split("/").filter(Boolean) ?? [];
  if (segments[0] === "experiments" && segments.length === 3) {
    const experiment = experimentIdSchema.safeParse(segments[1]);
    const unit = unitIdSchema.safeParse(segments[2]);
    const observation = observationIdSchema.safeParse(
      new URLSearchParams(link?.[2] ?? "").get("observation"),
    );
    if (!experiment.success || !unit.success) return null;
    return {
      kind: "unit",
      experiment: experiment.data,
      unit: unit.data,
      observation: observation.success ? observation.data : undefined,
    };
  }
  if (segments[0] === "datasets" && segments.length === 3) {
    const dataset = datasetIdSchema.safeParse(segments[1]);
    const digest = imageDigestSchema.safeParse(segments[2]);
    if (!dataset.success || !digest.success) return null;
    return { kind: "dataset", dataset: dataset.data, digest: digest.data };
  }
  return text ? { kind: "filename", name: text.toLowerCase() } : null;
}

/** A filename matches a name with or without its extension, in any case. */
function named(filename: SQLWrapper, name: string) {
  return or(
    sql`lower(${filename}) = ${name}`,
    sql`lower(regexp_replace(${filename}, '\\.[^.]*$', '')) = ${name}`,
  );
}

/**
 * The images a person names, each once per model it is annotated for, with
 * every place it is seen. A link names the one image its page shows; a
 * filename may name several, which the places tell apart.
 */
export async function findImages(
  image: string,
): Promise<ImageSearchOverview[]> {
  const want = wanted(image);
  if (!want) return [];
  return snapshot(async (db) => {
    const [inExperiments, inDatasets] = await Promise.all([
      want.kind === "dataset"
        ? []
        : db
            .select({
              digest: experimentObservationImages.imageId,
              modelId: experimentObservations.modelId,
              filename: experimentObservationImages.filename,
              experiment: experiments.name,
              unit: experimentUnits.code,
              observedOn: experimentObservations.observedOn,
            })
            .from(experimentObservationImages)
            .innerJoin(
              experiments,
              eq(experiments.id, experimentObservationImages.experimentId),
            )
            .innerJoin(experimentObservations, atImageObservation())
            .innerJoin(
              experimentUnits,
              and(
                eq(
                  experimentUnits.experimentId,
                  experimentObservationImages.experimentId,
                ),
                eq(experimentUnits.id, experimentObservationImages.unitId),
              ),
            )
            .where(
              want.kind === "unit"
                ? and(
                    eq(
                      experimentObservationImages.experimentId,
                      want.experiment,
                    ),
                    eq(experimentObservationImages.unitId, want.unit),
                    want.observation
                      ? eq(
                          experimentObservationImages.observationId,
                          want.observation,
                        )
                      : undefined,
                  )
                : named(experimentObservationImages.filename, want.name),
            )
            .orderBy(
              experimentObservations.observedOn,
              experiments.name,
              experimentUnits.code,
            ),
      want.kind === "unit"
        ? []
        : db
            .select({
              digest: datasetImages.imageId,
              modelId: datasets.modelId,
              filename: datasetImages.filename,
              dataset: datasets.name,
            })
            .from(datasetImages)
            .innerJoin(datasets, eq(datasets.id, datasetImages.datasetId))
            .where(
              want.kind === "dataset"
                ? and(
                    eq(datasetImages.datasetId, want.dataset),
                    eq(datasetImages.imageId, want.digest),
                  )
                : named(datasetImages.filename, want.name),
            )
            .orderBy(datasets.name),
    ]);
    // A unit's page without a day shows the newest day it was photographed on.
    const experimentRows =
      want.kind === "unit" && !want.observation
        ? inExperiments.slice(-1)
        : inExperiments;
    const found = new Map<string, ImageSearchOverview>();
    const place = (
      row: { digest: string; modelId: string; filename: string },
      where: ImagePlace,
    ) => {
      const key = `${row.digest}/${row.modelId}`;
      const entry = found.get(key) ?? {
        ref: { digest: row.digest, modelId: row.modelId },
        filename: row.filename,
        places: [],
      };
      entry.places.push(where);
      found.set(key, entry);
    };
    for (const { experiment, unit, observedOn, ...row } of experimentRows)
      place(row, { experiment, unit, observedOn });
    for (const { dataset, ...row } of inDatasets) place(row, { dataset });
    return [...found.values()];
  });
}
