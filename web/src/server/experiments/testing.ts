import { makeResult } from "../../domain/annotation/testing";
import {
  type Experiment,
  type ExperimentRequestInput,
  experimentRequestSchema,
} from "../../domain/experiments/schema";
import { SEED_DETECTOR } from "../../domain/models/builtins";
import type { ModelVersion } from "../../domain/models/schema";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { registerModel, setCurrentVersion } from "../models/registry";
import {
  FIXTURE_EDGE,
  registerTrainedVersion,
  storeTexts,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import { createExperiment as createExperimentRecord } from "./design";
import { assignObservationImages } from "./observation-images";
import { readExperimentGrid } from "./queries";

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

export const worker: Worker = {
  ...testHeartbeat("ultralytics-worker"),
  runtimes: [ULTRALYTICS_RUNTIME],
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

export async function trainedVersion(modelId: string): Promise<ModelVersion> {
  await registerModel({
    schemaVersion: 1,
    id: modelId,
    name: `${modelId} detector`,
    task: "object_detection",
    classes: SEED_DETECTOR.classes,
    annotation: DEFAULT_MODEL_ANNOTATION,
  });
  const version = await registerTrainedVersion(modelId);
  await setCurrentVersion({ model: modelId, version: version.id });
  return version;
}

export function reading(version: ModelVersion) {
  return { modelId: version.modelId };
}

export function resultFor(
  version: ModelVersion,
  digest: string,
  seeds: number,
) {
  return {
    ...makeResult(
      Array.from({ length: seeds }, (_, id) => ({
        id,
        x: 12 + id * 14,
        y: 12,
      })),
      { digest, dishRadius: 400, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    ),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
  };
}

export function failureFor(version: ModelVersion, digest: string) {
  return {
    schemaVersion: 1 as const,
    image: { digest },
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
    error: "no unit found",
  };
}

export async function unitsOf(
  experiment: string,
): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
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

export async function imagesByUnit(
  experiment: string,
): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
  const codes = new Map(grid!.units.map((unit) => [unit.id, unit.code]));
  return new Map(
    grid!.images.map((image) => [codes.get(image.unit)!, image.id]),
  );
}
