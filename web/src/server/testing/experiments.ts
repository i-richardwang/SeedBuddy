import { eq } from "drizzle-orm";

import { filenameStem } from "../../domain/experiments/naming";
import type {
  Experiment,
  ExperimentObservation,
  ObservationImageRef,
} from "../../domain/experiments/schema";
import {
  type ExperimentRequestInput,
  experimentRequestSchema,
} from "../../domain/experiments/schema";
import type { ModelVersion } from "../../domain/models/schema";
import { createExperiment as createExperimentRecord } from "../experiments/design";
import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import { listUnits } from "../experiments/records";
import { database } from "../infra/db/client";
import { experimentObservationImages } from "../infra/db/schema";
import { readModel } from "../models/registry";
import { experimentGridDetail } from "../queries/experiment-grid-detail";
import { storeTexts } from "./images";
import { baselineVersion } from "./models";

interface ObservedExperiment {
  experiment: Experiment;
  observation: ExperimentObservation;
  /** In the order of `contents`. */
  digests: string[];
  /** In the order of `contents`. */
  images: ObservationImageRef[];
}

export interface ObservedImages extends ObservedExperiment {
  version: ModelVersion;
}

/**
 * Lays out one replicate per text and assigns an image to each in the
 * experiment's first observation; the replicate `Test-n` shows `contents[n-1]`.
 * The model needs no version: an observation may be read by a reviewer alone.
 */
export async function observeImagesForModel(
  experimentName: string,
  contents: string[],
  modelId: string,
): Promise<ObservedExperiment> {
  const model = await readModel(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const experiment = await createExperimentRecord({
    name: experimentName,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    countsUnclear: false,
    treatments: [
      { name: "Test", factor: null, note: "", replicates: contents.length },
    ],
  });
  const units = await listUnits(experiment.id, await database());
  const byCode = new Map(
    contents.map((content, index) => [
      content,
      units.find((unit) => unit.code === `Test-${index + 1}`)!.id,
    ]),
  );
  const digests = await storeTexts(contents);
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    modelId,
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: contents.map((content, index) => ({
      unit: byCode.get(content)!,
      digest: digests[index]!,
      filename: `${content}.jpg`,
    })),
  });
  const cells = await listExperimentObservationImages(experiment.id);
  return {
    experiment,
    observation,
    digests,
    images: contents.map((content) => ({
      experiment: experiment.id,
      observationImage: cells.get(byCode.get(content)!)!,
    })),
  };
}

/** The same, read for the version's model, which the caller then detects with. */
export async function observeImages(
  experimentName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<ObservedImages> {
  const selectedVersion = version ?? (await baselineVersion());
  const observed = await observeImagesForModel(
    experimentName,
    contents,
    selectedVersion.modelId,
  );
  return { ...observed, version: selectedVersion };
}

/** Observation-image identifiers indexed by unit. */
async function listExperimentObservationImages(
  experimentId: string,
): Promise<Map<string, string>> {
  const rows = await (
    await database()
  )
    .select({
      unitId: experimentObservationImages.unitId,
      id: experimentObservationImages.id,
    })
    .from(experimentObservationImages)
    .where(eq(experimentObservationImages.experimentId, experimentId));
  return new Map(rows.map((row) => [row.unitId, row.id]));
}

/** Observation-image references by source filename stem. */
export async function listObservationImageRefs(experimentId: string) {
  const grid = await experimentGridDetail(experimentId);
  if (!grid) throw new Error(`missing experiment ${experimentId}`);
  return new Map(
    grid.images.map((image) => [
      filenameStem(image.filename),
      { experiment: experimentId, observationImage: image.id },
    ]),
  );
}

export const INOCULATED = "2026-08-01";

export async function createExperiment(
  value: Omit<ExperimentRequestInput, "treatments"> &
    Partial<Pick<ExperimentRequestInput, "treatments">>,
): Promise<Experiment> {
  return createExperimentRecord(
    experimentRequestSchema.parse({
      treatments: [{ name: "A", replicates: 1 }],
      ...value,
    }),
  );
}

export function reading(version: ModelVersion) {
  return { modelId: version.modelId };
}

export async function unitsOf(
  experiment: string,
): Promise<Map<string, string>> {
  const grid = await experimentGridDetail(experiment);
  return new Map(grid!.units.map((unit) => [unit.code, unit.id]));
}

export async function assignImages(
  experiment: string,
  observation: string,
  units: Map<string, string>,
  contents: Record<string, string>,
) {
  const entries = Object.entries(contents);
  const digests = await storeTexts(entries.map(([, content]) => content));
  return assignObservationImages({
    experiment,
    observation,
    images: entries.map(([code], index) => ({
      unit: units.get(code)!,
      digest: digests[index]!,
      filename: `${code}.jpg`,
    })),
  });
}
