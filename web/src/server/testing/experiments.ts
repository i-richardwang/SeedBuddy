import { eq } from "drizzle-orm";

import { filenameStem } from "../../domain/experiments/naming";
import type {
  Experiment,
  ExperimentObservation,
  ObservationImageRef,
} from "../../domain/experiments/schema";
import type { ModelVersion } from "../../domain/models/schema";
import { createExperiment } from "../experiments/design";
import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import { readExperimentGrid } from "../experiments/queries";
import { listUnits } from "../experiments/records";
import { database } from "../infra/db/client";
import { experimentObservationImages } from "../infra/db/schema";
import { readModel } from "../models/registry";
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
  const experiment = await createExperiment({
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
  const grid = await readExperimentGrid(experimentId);
  if (!grid) throw new Error(`missing experiment ${experimentId}`);
  return new Map(
    grid.images.map((image) => [
      filenameStem(image.filename),
      { experiment: experimentId, observationImage: image.id },
    ]),
  );
}
