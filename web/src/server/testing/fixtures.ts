import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import sharp from "sharp";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { makeResult } from "../../domain/annotation/testing";
import type { Dataset } from "../../domain/datasets/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { filenameStem } from "../../domain/experiments/naming";
import type {
  Experiment,
  ExperimentObservation,
  ObservationImageRef,
} from "../../domain/experiments/schema";
import type { RuntimeDescriptor } from "../../domain/inference/schema";
import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE_VERSION_ID,
} from "../../domain/models/builtins";
import type { Tally } from "../../domain/models/classes";
import type { ModelVersion } from "../../domain/models/schema";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import type { Worker, WorkerHeartbeat } from "../../domain/workers/schema";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import {
  addExperimentObservationImages,
  addExperimentObservationImagesToNewDataset,
  createDataset,
  readDatasetByName,
} from "../datasets/memberships";
import { createExperiment } from "../experiments/design";
import { assignObservationImages } from "../experiments/observation-images";
import { addObservation } from "../experiments/observations";
import { readExperimentGrid } from "../experiments/queries";
import { listUnits } from "../experiments/records";
import { canonicalize } from "../images/ingest";
import { storeImage } from "../images/store";
import { database, transaction } from "../infra/db/client";
import {
  datasetSnapshotImages,
  datasetSnapshots,
  experimentObservationImages,
  trainingRuns,
  workers,
} from "../infra/db/schema";
import {
  readCurrentVersionId,
  readModel,
  readModelVersion,
  registerModel,
  registerModelVersion,
  setCurrentVersion,
} from "../models/registry";
import { recordWorkerHeartbeat } from "../workers/sessions";
import { seedDetectionResult } from "./inference";

export const TEST_RUNTIME: RuntimeDescriptor = {
  adapter: "traditional",
  fingerprint: "b".repeat(64),
};

export const ULTRALYTICS_RUNTIME: RuntimeDescriptor = {
  adapter: "ultralytics",
  fingerprint: "e".repeat(64),
};

/** The builtin seed germination model every deployment starts with. */
export async function baselineVersion(): Promise<ModelVersion> {
  const version = await readModelVersion(SEED_DETECTOR_BASELINE_VERSION_ID);
  if (!version) throw new Error("builtin models are not registered");
  return version;
}

/**
 * A model of a test's own, with a traditional version the way a builtin ships:
 * the first one registered reads until another is chosen. A test that needs
 * several versions registers them here rather than against the builtin model
 * every other test observes with.
 */
export async function traditionalVersion(
  modelId: string,
  slug: string,
  createdAt = "2026-08-26T01:00:00.000Z",
): Promise<ModelVersion> {
  await registerModel({
    schemaVersion: 1,
    id: modelId,
    name: `${modelId} detector`,
    task: "object_detection",
    classes: SEED_DETECTOR.classes,
    annotation: DEFAULT_MODEL_ANNOTATION,
  });
  const version = await registerModelVersion({
    schemaVersion: 1,
    id: `${modelId}.${slug}`,
    modelId,
    createdAt,
    source: { kind: "builtin", definition: slug },
    artifact: { kind: "traditional", digest: "c".repeat(64) },
  });
  if ((await readCurrentVersionId(modelId)) === null) {
    await setCurrentVersion({ model: modelId, version: version.id });
  }
  return version;
}

/**
 * Registers a trained version of `modelId`, as a training run would publish
 * it: a candidate, which reads nothing until a test makes it current.
 */
export async function registerTrainedVersion(
  modelId: string,
  slug = "yolo-v1",
): Promise<ModelVersion> {
  const datasetName = `${modelId}.${slug}.dataset`;
  const snapshotId = `${modelId}.${slug}.snapshot`;
  const runId = `${modelId}.${slug}.run`;
  const value: ModelVersion = {
    schemaVersion: 1,
    id: `${modelId}.${slug}`,
    modelId,
    createdAt: "2026-08-27T02:00:00.000Z",
    source: {
      kind: "training_run",
      trainingRunId: runId,
      trainingAttempt: 1,
      datasetSnapshotId: snapshotId,
    },
    artifact: {
      kind: "ultralytics",
      digest: createHash("sha256").update(`${modelId}.${slug}`).digest("hex"),
      weights: { digest: "c".repeat(64), bytes: 10 },
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.6,
        recall: 0.5,
        map50: 0.8,
        map50To95: 0.4,
        fitness: 0.44,
      },
      training: YOLO26N_WHOLE_RECIPE,
    },
  };
  return transaction(async (tx) => {
    const { id: datasetId } =
      (await readDatasetByName(datasetName, tx)) ??
      (await createDataset({ name: datasetName, modelId }, tx));
    await tx
      .insert(datasetSnapshots)
      .values({ id: snapshotId, datasetId, modelId, createdAt: new Date() })
      .onConflictDoNothing();
    await tx
      .insert(trainingRuns)
      .values({
        id: runId,
        modelId,
        datasetSnapshotId: snapshotId,
        createdAt: new Date(value.createdAt),
        attempt: 1,
        recipe: YOLO26N_WHOLE_RECIPE,
        status: "queued",
      })
      .onConflictDoNothing();
    const version = await registerModelVersion(value, tx);
    await tx
      .update(trainingRuns)
      .set({ status: "succeeded", modelVersionId: version.id })
      .where(eq(trainingRuns.id, runId));
    return version;
  });
}

/** A heartbeat from a worker that executes only `TEST_RUNTIME`. */
export function testHeartbeat(workerId: string): WorkerHeartbeat {
  return {
    workerId,
    sessionId: `session-${workerId}`,
    startedAt: "2026-08-27T00:00:00.000Z",
    runtimes: [TEST_RUNTIME],
    memoryBytes: 8 * 1024 ** 3,
  };
}

/**
 * A heartbeat from a worker the test enrolled, enrolling it on first use as an
 * administrator would.
 */
export async function recordTestHeartbeat(
  heartbeat: WorkerHeartbeat,
  at?: Date,
): Promise<Worker> {
  await (
    await database()
  )
    .insert(workers)
    .values({
      id: heartbeat.workerId,
      tokenHash: `test-${heartbeat.workerId}`,
      enrolledAt: new Date(),
    })
    .onConflictDoNothing();
  return recordWorkerHeartbeat(heartbeat, at);
}

/** Fixture images are grids of flat blocks so lossy encoding keeps them distinct. */
const FIXTURE_BLOCKS = 8;
const FIXTURE_BLOCK_PIXELS = 8;
export const FIXTURE_EDGE = FIXTURE_BLOCKS * FIXTURE_BLOCK_PIXELS;

/** A source image whose pixels follow from `content`. */
export async function imageBytes(
  content: string,
  format: "png" | "jpeg" | "tiff" = "png",
): Promise<Uint8Array<ArrayBuffer>> {
  const seed = createHash("sha256").update(content).digest();
  const pixels = Buffer.alloc(FIXTURE_EDGE * FIXTURE_EDGE * 3);
  for (let y = 0; y < FIXTURE_EDGE; y += 1) {
    for (let x = 0; x < FIXTURE_EDGE; x += 1) {
      const block =
        Math.floor(y / FIXTURE_BLOCK_PIXELS) * FIXTURE_BLOCKS +
        Math.floor(x / FIXTURE_BLOCK_PIXELS);
      const offset = (y * FIXTURE_EDGE + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = seed[(block * 3 + channel) % seed.length]!;
      }
    }
  }
  const image = sharp(pixels, {
    raw: { width: FIXTURE_EDGE, height: FIXTURE_EDGE, channels: 3 },
  });
  const encoded =
    format === "png"
      ? image.png()
      : format === "jpeg"
        ? image.jpeg()
        : image.tiff();
  const encodedBytes = await encoded.toBuffer();
  const bytes = new Uint8Array(new ArrayBuffer(encodedBytes.byteLength));
  bytes.set(encodedBytes);
  return bytes;
}

/** The digest `imageBytes(content)` is stored under once it is canonicalised. */
export async function imageDigest(content: string): Promise<string> {
  return (await canonicalize(await imageBytes(content))).digest;
}

/** Stores one deterministic source per text, returning the digests in order. */
export async function storeTexts(contents: string[]): Promise<string[]> {
  const digests = [];
  for (const content of contents) {
    digests.push((await storeImage(await imageBytes(content))).digest);
  }
  return digests;
}

interface ObservedExperiment {
  experiment: Experiment;
  observation: ExperimentObservation;
  /** In the order of `contents`. */
  digests: string[];
  /** In the order of `contents`. */
  images: ObservationImageRef[];
}

interface ObservedImages extends ObservedExperiment {
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
  const observation = await addObservation({
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

interface SeededDataset extends ObservedImages {
  dataset: Dataset;
}

/**
 * Creates observation images from the texts and adds them to the dataset of
 * this name, founding it on the first call.
 */
export async function observeTextsIntoDataset(
  datasetName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const observation = await observeImages(
    `${datasetName} images`,
    contents,
    version,
  );
  const existing = await readDatasetByName(datasetName);
  const { dataset } = existing
    ? await addExperimentObservationImages({
        dataset: existing.id,
        images: observation.images,
      })
    : await addExperimentObservationImagesToNewDataset({
        name: datasetName,
        images: observation.images,
      });
  return { ...observation, dataset };
}

/** A result `version` would produce for the image with these bytes. */
export async function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: await imageDigest(content),
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
}

/**
 * Uploads the texts and reviews each, ready for training. A review belongs
 * to the image and the model, so texts already reviewed by an earlier call
 * keep the review they have.
 */
export async function reviewedDataset(
  datasetName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const seeded = await observeTextsIntoDataset(datasetName, contents, version);
  for (const content of contents) {
    const ref = {
      digest: await imageDigest(content),
      modelId: seeded.version.modelId,
    };
    if (await readAnnotation(ref)) continue;
    const result = await resultFor(seeded.version, content);
    await seedDetectionResult(
      { digest: ref.digest, versionId: seeded.version.id },
      result,
      { runtimes: [result.producer.runtime] },
    );
    await storeAnnotation(ref, instancesFromDetection(result), null);
  }
  return seeded;
}

/** One box per instance the tally counts, laid along the top of the image. */
function countedInstances(counted: Tally) {
  return Object.entries(counted)
    .flatMap(([name, total]) => Array.from({ length: total }, () => name))
    .map((name, index) => ({
      id: String(index),
      class: name,
      bbox: { x: index, y: 0, width: 1, height: 1 },
    }));
}

/** A detection by `version` that counts exactly the tally. */
export async function countedResult(
  version: ModelVersion,
  content: string,
  counted: Tally,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  const result = await resultFor(version, content, runtime);
  return {
    ...result,
    instances: countedInstances(counted).map((instance) => ({
      ...instance,
      score: 0.9,
    })),
  };
}

/**
 * Freezes the images into the snapshot a trained version was published from,
 * each with its split and the counts its review holds, as a training snapshot
 * would. Returns the digests in order.
 */
export async function snapshotImages(
  version: ModelVersion,
  images: { content: string; split: "train" | "val"; reviewed: Tally }[],
): Promise<string[]> {
  if (version.source.kind !== "training_run") {
    throw new Error(`${version.id} was not trained`);
  }
  const { datasetSnapshotId: snapshotId } = version.source;
  const digests = await storeTexts(images.map((image) => image.content));
  await (await database()).insert(datasetSnapshotImages).values(
    images.map((image, index) => ({
      snapshotId,
      modelId: version.modelId,
      imageId: digests[index]!,
      split: image.split,
      annotation: {
        schemaVersion: 1 as const,
        image: {
          digest: digests[index]!,
          width: FIXTURE_EDGE,
          height: FIXTURE_EDGE,
        },
        instances: countedInstances(image.reviewed),
      },
    })),
  );
  return digests;
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
