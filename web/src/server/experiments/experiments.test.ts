import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { makeResult } from "../../domain/annotation/testing";
import {
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  ExperimentObservationImageAlreadyUsedError,
  ExperimentRejectedError,
  ManualReadingRejectedError,
  ObservationImageRejectedError,
  ObservationModelHasCountsError,
  ObservationNotFoundError,
  ObservationRejectedError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
  UnitNotFoundError,
  UnitRejectedError,
} from "../../domain/experiments/errors";
import {
  observationCells,
  unitReading,
} from "../../domain/experiments/readings";
import {
  calendarDaySchema,
  type Experiment,
  type ExperimentRequestInput,
  experimentRequestSchema,
  formatFactor,
  treatmentRequestSchema,
} from "../../domain/experiments/schema";
import { ImageNotFoundError } from "../../domain/images/errors";
import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE_VERSION_ID,
  SEED_DETECTOR_MODEL_ID,
} from "../../domain/models/builtins";
import {
  ModelNotFoundError,
  UnknownClassError,
} from "../../domain/models/errors";
import type { ModelVersion } from "../../domain/models/schema";
import { DEFAULT_MODEL_ANNOTATION } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { storeAnnotation } from "../annotations/documents";
import { collectImages } from "../images/collection";
import { imageBlobKey } from "../images/keys";
import { clearImageUnclear, markImageUnclear } from "../images/unclear";
import { blobExists } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import {
  experimentCultureEvents,
  experimentObservations,
  experimentUnits,
  inferenceOutcomes,
} from "../infra/db/schema";
import { readModel } from "../models/public";
import {
  createModel,
  listAllModelVersions,
  registerModel,
  setCurrentVersion,
} from "../models/registry";
import {
  baselineVersion,
  FIXTURE_EDGE,
  imageDigest,
  registerTrainedVersion,
  storeTexts,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import {
  seedDetectionResult,
  seedInferenceTaskFailure,
} from "../testing/inference";
import {
  deleteCultureEvent,
  recordCultureEvent,
  recordCultureEvents,
} from "./culture-events";
import {
  addReplicates,
  addTreatment,
  createExperiment as createExperimentRecord,
  deleteExperiment,
  deleteTreatment,
  deleteUnit,
  moveUnits,
  updateExperiment,
  updateTreatment,
  updateUnit,
} from "./design";
import { recordManualReadings } from "./manual-readings";
import {
  assignObservationImages,
  recordObservation,
  retryObservationImageAnalysis,
  unassignObservationImage,
} from "./observation-images";
import {
  addObservation,
  deleteObservation,
  updateObservation,
} from "./observations";
import {
  listExperiments,
  readExperimentGrid,
  readExperimentObservationImage,
  readUnit,
} from "./queries";

const INOCULATED = "2026-08-01";

async function createExperiment(
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

const worker: Worker = {
  ...testHeartbeat("ultralytics-worker"),
  runtimes: [ULTRALYTICS_RUNTIME],
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function trainedVersion(modelId: string): Promise<ModelVersion> {
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

function reading(version: ModelVersion) {
  return { modelId: version.modelId };
}

function resultFor(version: ModelVersion, digest: string, seeds: number) {
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

function failureFor(version: ModelVersion, digest: string) {
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

async function unitsOf(experiment: string): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
  return new Map(grid!.units.map((unit) => [unit.code, unit.id]));
}

async function assignImages(
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

async function imagesByUnit(experiment: string): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
  const codes = new Map(grid!.units.map((unit) => [unit.id, unit.code]));
  return new Map(
    grid!.images.map((image) => [codes.get(image.unit)!, image.id]),
  );
}

describe("experiments", () => {
  test("start on a fresh deployment with the builtin seed germination model", async () => {
    expect(calendarDaySchema.safeParse("2026-02-29").success).toBeFalse();
    expect(calendarDaySchema.safeParse("2024-02-29").success).toBeTrue();
    const offered = await listAllModelVersions();
    expect(offered.map((version) => version.id)).toContain(
      SEED_DETECTOR_BASELINE_VERSION_ID,
    );
    const experiment = await createExperiment({
      name: "Day one",
      inoculatedOn: INOCULATED,
    });
    expect(experiment.inoculatedOn).toBe(INOCULATED);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: INOCULATED,
      note: "",
      modelId: SEED_DETECTOR_MODEL_ID,
    });
    expect(observation.modelId).toBe(SEED_DETECTOR_MODEL_ID);
  });

  test("have server-owned identities and one name each", async () => {
    const first = await createExperiment({
      name: "  Germination A  ",
      inoculatedOn: INOCULATED,
    });
    await expect(
      createExperiment({
        name: "germination a",
        inoculatedOn: INOCULATED,
      }),
    ).rejects.toThrow(ExperimentRejectedError);

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.name).toBe("Germination A");

    const invalidUnit = (async () => {
      const [treatment] = (await readExperimentGrid(first.id))!.treatments;
      await (await database()).insert(experimentUnits).values({
        experimentId: first.id,
        id: randomUUID(),
        code: " A1 ",
        treatmentId: treatment!.id,
      });
    })();
    await expect(invalidUnit).rejects.toThrow();
  });

  test("the design lays out units before any image exists", async () => {
    const experiment = await createExperiment({
      name: "Hormones",
      plantMaterial: "  Arabidopsis Col-0  ",
      explantType: "Seeds",
      baseMedium: "MS",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", note: "Hormone-free MS", replicates: 2 },
        {
          name: " T1 ",
          factor: { name: " 6-BA ", level: "1.0", unit: " mg/L " },
          replicates: 3,
        },
      ],
    });
    expect(experiment.plantMaterial).toBe("Arabidopsis Col-0");
    expect([experiment.explantType, experiment.baseMedium]).toEqual([
      "Seeds",
      "MS",
    ]);
    expect(experiment.notes).toBe("");

    const grid = (await readExperimentGrid(experiment.id))!;
    const [control, auxin] = grid.treatments;
    expect([control?.position, auxin?.position]).toEqual([1, 2]);
    expect(control?.note).toBe("Hormone-free MS");
    expect(auxin?.name).toBe("T1");
    expect(auxin?.factor).toEqual({
      name: "6-BA",
      level: "1.0",
      unit: "mg/L",
    });
    expect(grid.observations).toEqual([]);
    expect(grid.units.map((unit) => [unit.code, unit.treatment])).toEqual([
      ["CK-1", control?.id],
      ["CK-2", control?.id],
      ["T1-1", auxin?.id],
      ["T1-2", auxin?.id],
      ["T1-3", auxin?.id],
    ]);
    expect(grid.units.every((unit) => unit.events.length === 0)).toBeTrue();

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.treatments).toBe(2);
    expect(summary?.units).toBe(5);
    expect(summary?.observations).toBe(0);
    expect(summary?.lastObservedOn).toBeNull();
  });

  test("an experiment cannot be created without a design", async () => {
    expect(
      experimentRequestSchema.safeParse({
        name: "Undesigned",
        inoculatedOn: INOCULATED,
        treatments: [],
      }).success,
    ).toBeFalse();
    expect(
      experimentRequestSchema.safeParse({
        name: "Undesigned",
        inoculatedOn: INOCULATED,
        treatments: [
          { name: "CK", replicates: 1 },
          { name: "ck", replicates: 1 },
        ],
      }).success,
    ).toBeFalse();
    expect(
      treatmentRequestSchema.safeParse({
        experiment: randomUUID(),
        name: "CK",
        replicates: 0,
      }).success,
    ).toBeFalse();
  });

  test("an observation reads for a model the registry holds", async () => {
    const version = await trainedVersion("exp-reading");
    const experiment = await createExperiment({
      name: "Reading",
      inoculatedOn: INOCULATED,
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
        modelId: "nobody",
      }),
    ).rejects.toThrow(ModelNotFoundError);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    expect(observation.modelId).toBe(version.modelId);

    const traditional = await baselineVersion();
    const reread = await updateObservation({
      experiment: experiment.id,
      observation: observation.id,
      observedOn: observation.observedOn,
      note: observation.note,
      modelId: traditional.modelId,
      countedClasses: (await readModel(traditional.modelId))!.classes,
    });
    expect(reread.modelId).toBe(traditional.modelId);

    const unknownModel = (async () => {
      await (
        await database()
      )
        .update(experimentObservations)
        .set({ modelId: "nobody" })
        .where(eq(experimentObservations.id, observation.id));
    })();
    await expect(unknownModel).rejects.toThrow();
  });

  test("an observation counts the classes it names, in its model's order", async () => {
    const version = await trainedVersion("exp-counted");
    const experiment = await createExperiment({
      name: "Counted",
      inoculatedOn: INOCULATED,
    });
    const sown = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-01",
      note: "",
      ...reading(version),
    });
    expect(sown.countedClasses).toEqual([...SEED_DETECTOR.classes]);

    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
        ...reading(version),
        countedClasses: ["germinated", "shoot"],
      }),
    ).rejects.toThrow(UnknownClassError);
    const germinated = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
      countedClasses: ["germinated"],
    });
    expect(germinated.countedClasses).toEqual(["germinated"]);

    const reordered = await updateObservation({
      experiment: experiment.id,
      observation: sown.id,
      observedOn: sown.observedOn,
      note: sown.note,
      ...reading(version),
      countedClasses: ["germinated", "ungerminated"],
    });
    expect(reordered.countedClasses).toEqual([...SEED_DETECTOR.classes]);

    const empty = (async () => {
      await (
        await database()
      )
        .update(experimentObservations)
        .set({ countedClasses: [] })
        .where(eq(experimentObservations.id, germinated.id));
    })();
    await expect(empty).rejects.toThrow();
  });

  test("an untrained model is observed and read by a reviewer alone", async () => {
    const model = await createModel({
      id: "exp-untrained",
      name: "Rooting",
      classes: ["rooted"],
    });
    const experiment = await createExperiment({
      name: "Untrained",
      inoculatedOn: INOCULATED,
    });
    const units = await unitsOf(experiment.id);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      modelId: model.id,
    });
    await assignImages(experiment.id, observation.id, units, {
      "A-1": "untrained-d14",
    });
    const digest = await imageDigest("untrained-d14");
    const cell = async () =>
      (await readExperimentGrid(experiment.id))!.images.find(
        (image) => image.digest === digest,
      )!;

    expect((await cell()).state).toBe("unread");
    expect((await cell()).detectionTally).toBeNull();

    const image = (await readExperimentObservationImage({
      experiment: experiment.id,
      observationImage: (await cell()).id,
    }))!;
    expect(image.model.id).toBe(model.id);
    expect(image.review.detection).toBeNull();

    await storeAnnotation(
      { digest, modelId: model.id },
      [
        {
          id: "a",
          class: "rooted",
          bbox: { x: 2, y: 3, width: 4, height: 5 },
        },
        {
          id: "b",
          class: "rooted",
          bbox: { x: 9, y: 3, width: 4, height: 5 },
        },
      ],
      null,
    );
    expect((await cell()).annotationTally).toEqual({ rooted: 2 });
  });

  test("observations of one experiment read with different models", async () => {
    await registerModel({
      schemaVersion: 1,
      id: "exp-stage-callus",
      name: "Callus detector",
      task: "object_detection",
      classes: ["callus"],
      annotation: DEFAULT_MODEL_ANNOTATION,
    });
    const callus = await registerTrainedVersion("exp-stage-callus");
    await setCurrentVersion({ model: callus.modelId, version: callus.id });
    const seeds = await trainedVersion("exp-stage-seeds");
    const experiment = await createExperiment({
      name: "Stages",
      inoculatedOn: INOCULATED,
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(callus),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(seeds),
    });
    await assignImages(experiment.id, day7.id, units, { "A-1": "stage-d7" });
    await assignImages(experiment.id, day14.id, units, { "A-1": "stage-d14" });
    const digest = await imageDigest("stage-d14");
    const grid = (await readExperimentGrid(experiment.id))!;
    expect(
      grid.observations.map((item) => [item.observedOn, item.modelId]),
    ).toEqual([
      ["2026-08-08", callus.modelId],
      ["2026-08-15", seeds.modelId],
    ]);
    const ref = {
      experiment: experiment.id,
      observationImage: grid.images.find((image) => image.digest === digest)!
        .id,
    };
    const cell = async () =>
      (await readExperimentGrid(experiment.id))!.images.find(
        (image) => image.digest === digest,
      )!;
    const reread = async (modelId: string) =>
      updateObservation({
        experiment: experiment.id,
        observation: day14.id,
        observedOn: day14.observedOn,
        note: day14.note,
        modelId,
        countedClasses: (await readModel(modelId))!.classes,
      });

    const found = resultFor(seeds, digest, 2);
    await seedDetectionResult({ versionId: seeds.id, digest }, found, worker);
    await storeAnnotation(
      { digest, modelId: seeds.modelId },
      instancesFromDetection(found),
      null,
    );
    expect((await cell()).state).toBe("analyzed");
    const before = (await readExperimentObservationImage(ref))!;
    expect(before.model.id).toBe(seeds.modelId);
    expect(before.review.detection?.instances).toHaveLength(2);
    expect(before.review.annotation).not.toBeNull();

    await reread(callus.modelId);
    expect((await cell()).state).toBe("pending");
    const switched = (await readExperimentObservationImage(ref))!;
    expect(switched.model.id).toBe(callus.modelId);
    expect(switched.review.detection).toBeNull();
    expect(switched.review.annotation).toBeNull();

    await reread(seeds.modelId);
    expect((await cell()).state).toBe("analyzed");
    const restored = (await readExperimentObservationImage(ref))!;
    expect(restored.review.detection).toEqual(before.review.detection);
    expect(restored.review.annotation).toEqual(before.review.annotation);
  });

  test("a trained version reads only once it is made current, and the one left behind returns at once", async () => {
    const first = await trainedVersion("exp-retrained");
    const experiment = await createExperiment({
      name: "Retrained",
      inoculatedOn: INOCULATED,
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(first),
    });
    await assignImages(experiment.id, day7.id, units, {
      "A-1": "retrained-d7",
    });
    const digest = await imageDigest("retrained-d7");
    const imageOf = async () =>
      (await readExperimentGrid(experiment.id))!.images.find(
        (image) => image.digest === digest,
      )!;
    const ref = {
      experiment: experiment.id,
      observationImage: (await imageOf()).id,
    };
    await seedDetectionResult(
      { versionId: first.id, digest },
      resultFor(first, digest, 3),
      worker,
    );
    const read = (await readExperimentObservationImage(ref))!;
    expect(read.review.detection?.instances).toHaveLength(3);

    const next = await registerTrainedVersion("exp-retrained", "yolo-v2");
    expect((await imageOf()).state).toBe("analyzed");

    await setCurrentVersion({ model: "exp-retrained", version: next.id });
    expect((await imageOf()).state).toBe("pending");
    expect(
      (await readExperimentObservationImage(ref))!.review.detection?.instances,
    ).toHaveLength(3);

    await setCurrentVersion({ model: "exp-retrained", version: first.id });
    expect((await imageOf()).state).toBe("analyzed");
    expect((await imageOf()).detectionTally).toEqual({ ungerminated: 3 });
  });

  test("an observation can be scheduled before any image exists", async () => {
    const version = await trainedVersion("exp-planned-observation");
    const experiment = await createExperiment({
      name: "Planned observation",
      inoculatedOn: INOCULATED,
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
        ...reading(version),
      }),
    ).resolves.toMatchObject({ observedOn: "2026-08-08" });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-15",
        note: "",
        ...reading(version),
      }),
    ).resolves.toMatchObject({ observedOn: "2026-08-15" });

    await deleteExperiment({ experiment: experiment.id });
    expect(await readExperimentGrid(experiment.id)).toBeNull();
  });

  test("a treatment can gain replicates after it is designed", async () => {
    const experiment = await createExperiment({
      name: "More units",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "T1", replicates: 1 }],
    });
    const [treatment] = (await readExperimentGrid(experiment.id))!.treatments;
    const added = await addReplicates({
      experiment: experiment.id,
      treatment: treatment!.id,
      replicates: 2,
    });
    expect(added.map((unit) => unit.code)).toEqual(["T1-2", "T1-3"]);
    await expect(
      addReplicates({
        experiment: experiment.id,
        treatment: randomUUID(),
        replicates: 1,
      }),
    ).rejects.toThrow(TreatmentNotFoundError);
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.units.map((unit) => unit.code)).toEqual([
      "T1-1",
      "T1-2",
      "T1-3",
    ]);
  });

  test("treatment names and unit codes are unique", async () => {
    const experiment = await createExperiment({
      name: "Unique",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", replicates: 2 },
        { name: "T1", replicates: 1 },
      ],
    });
    const [control, treated] = (await readExperimentGrid(experiment.id))!
      .treatments;

    await expect(
      addTreatment({
        experiment: experiment.id,
        name: "ck",
        factor: null,
        note: "",
        replicates: 1,
      }),
    ).rejects.toThrow(TreatmentRejectedError);
    await expect(
      updateTreatment({
        experiment: experiment.id,
        treatment: treated!.id,
        name: "CK",
        factor: null,
        note: "",
      }),
    ).rejects.toThrow(TreatmentRejectedError);

    const units = await unitsOf(experiment.id);
    await expect(
      updateUnit({
        experiment: experiment.id,
        unit: units.get("T1-1")!,
        code: "ck-1",
        treatment: treated!.id,
      }),
    ).rejects.toThrow(UnitRejectedError);
    await expect(
      updateUnit({
        experiment: experiment.id,
        unit: units.get("T1-1")!,
        code: "T1-1",
        treatment: randomUUID(),
      }),
    ).rejects.toThrow(TreatmentNotFoundError);
    await expect(
      updateUnit({
        experiment: experiment.id,
        unit: randomUUID(),
        code: "X-1",
        treatment: treated!.id,
      }),
    ).rejects.toThrow(UnitNotFoundError);

    const moved = await updateUnit({
      experiment: experiment.id,
      unit: units.get("CK-1")!,
      code: "CK-1",
      treatment: treated!.id,
    });
    expect(moved.treatment).toBe(treated!.id);

    await deleteTreatment({
      experiment: experiment.id,
      treatment: control!.id,
    });
    const after = await readExperimentGrid(experiment.id);
    expect(after?.treatments).toEqual([{ ...treated!, position: 1 }]);
    expect(after?.units.map((unit) => [unit.code, unit.treatment])).toEqual([
      ["CK-1", treated!.id],
      ["T1-1", treated!.id],
    ]);
  });

  test("an experiment keeps a treatment, and a treatment keeps a replicate", async () => {
    const experiment = await createExperiment({
      name: "Floor",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", replicates: 1 },
        { name: "T1", replicates: 2 },
      ],
    });
    const [control, treated] = (await readExperimentGrid(experiment.id))!
      .treatments;
    const units = await unitsOf(experiment.id);

    await expect(
      deleteUnit({ experiment: experiment.id, unit: units.get("CK-1")! }),
    ).rejects.toThrow(UnitRejectedError);
    await expect(
      updateUnit({
        experiment: experiment.id,
        unit: units.get("CK-1")!,
        code: "CK-1",
        treatment: treated!.id,
      }),
    ).rejects.toThrow(UnitRejectedError);
    await deleteUnit({ experiment: experiment.id, unit: units.get("T1-2")! });

    await deleteTreatment({
      experiment: experiment.id,
      treatment: control!.id,
    });
    await expect(
      deleteTreatment({ experiment: experiment.id, treatment: treated!.id }),
    ).rejects.toThrow(TreatmentRejectedError);
    expect(
      (await readExperimentGrid(experiment.id))?.units.map((unit) => unit.code),
    ).toEqual(["T1-1"]);
  });

  test("several units can move to another treatment together", async () => {
    const experiment = await createExperiment({
      name: "Move units",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", replicates: 3 },
        { name: "T1", replicates: 1 },
      ],
    });
    const [control, treated] = (await readExperimentGrid(experiment.id))!
      .treatments;
    const units = await unitsOf(experiment.id);

    await expect(
      moveUnits({
        experiment: experiment.id,
        units: [units.get("CK-1")!, units.get("CK-2")!, units.get("CK-3")!],
        treatment: treated!.id,
      }),
    ).rejects.toThrow(UnitRejectedError);
    expect(
      (await readExperimentGrid(experiment.id))?.units.filter(
        (unit) => unit.treatment === control!.id,
      ),
    ).toHaveLength(3);

    const moved = await moveUnits({
      experiment: experiment.id,
      units: [units.get("CK-1")!, units.get("CK-2")!],
      treatment: treated!.id,
    });
    expect(moved.map((unit) => unit.treatment)).toEqual([
      treated!.id,
      treated!.id,
    ]);
    expect(
      (await readExperimentGrid(experiment.id))?.units.filter(
        (unit) => unit.treatment === control!.id,
      ),
    ).toHaveLength(1);
  });

  test("a treatment leaves with its units unless they have records", async () => {
    const version = await trainedVersion("exp-delete-treatment");
    const experiment = await createExperiment({
      name: "Delete treatment",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "CK", replicates: 2 },
        { name: "T1", replicates: 1 },
      ],
    });
    const [control, treated] = (await readExperimentGrid(experiment.id))!
      .treatments;
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignImages(
      experiment.id,
      observation.id,
      await unitsOf(experiment.id),
      {
        "T1-1": "t1-1",
      },
    );

    await expect(
      deleteTreatment({ experiment: experiment.id, treatment: treated!.id }),
    ).rejects.toThrow(TreatmentRejectedError);
    await deleteTreatment({
      experiment: experiment.id,
      treatment: control!.id,
    });
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.treatments.map((treatment) => treatment.name)).toEqual(["T1"]);
    expect(grid?.units.map((unit) => unit.code)).toEqual(["T1-1"]);
    expect(grid?.images).toHaveLength(1);
  });

  test("a unit keeps its images when its code is corrected", async () => {
    const version = await trainedVersion("exp-rename");
    const experiment = await createExperiment({
      name: "Typo",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignImages(experiment.id, observation.id, units, {
      "A-1": "r-a1",
    });

    const [treatment] = (await readExperimentGrid(experiment.id))!.treatments;
    const renamed = await updateUnit({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      code: "A-01",
      treatment: treatment!.id,
    });
    expect(renamed.code).toBe("A-01");
    await expect(
      updateUnit({
        experiment: experiment.id,
        unit: units.get("A-2")!,
        code: "A-01",
        treatment: treatment!.id,
      }),
    ).rejects.toThrow(UnitRejectedError);

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.units.map((unit) => unit.code)).toEqual(["A-01", "A-2"]);
    expect(grid?.images).toHaveLength(1);
    expect(grid?.images[0]?.unit).toBe(units.get("A-1")!);
  });

  test("observations are dated once and ordered by the day they happened", async () => {
    const version = await trainedVersion("exp-observations");
    const experiment = await createExperiment({
      name: "Series",
      inoculatedOn: INOCULATED,
      treatments: [
        { name: "A", replicates: 10 },
        { name: "B", replicates: 1 },
      ],
    });
    const units = await unitsOf(experiment.id);

    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "First look",
      ...reading(version),
    });
    expect([day7.ordinal, day7.observedOn, day7.note]).toEqual([
      1,
      "2026-08-08",
      "First look",
    ]);

    const day21 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-22",
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-15",
        note: "",
        ...reading(version),
      }),
    ).rejects.toThrow(ObservationRejectedError);

    await assignImages(experiment.id, day7.id, units, {
      "A-2": "s-a2-7",
      "A-10": "s-a10-7",
      "B-1": "s-b1-7",
    });
    await assignImages(experiment.id, day14.id, units, {
      "A-2": "s-a2-14",
    });

    const grid = await readExperimentGrid(experiment.id);
    expect(
      grid?.observations.map(({ id, observedOn }) => [id, observedOn]),
    ).toEqual([
      [day7.id, "2026-08-08"],
      [day14.id, "2026-08-15"],
      [day21.id, "2026-08-22"],
    ]);
    expect(grid?.units.map((unit) => unit.code)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `A-${index + 1}`),
      "B-1",
    ]);
    expect(grid?.images).toHaveLength(4);

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.units).toBe(11);
    expect(summary?.observations).toBe(3);
    expect(summary?.lastObservedOn).toBe("2026-08-22");
  });

  test("an observation day is recorded with its photographs, or not at all", async () => {
    const version = await trainedVersion("exp-record");
    const experiment = await createExperiment({
      name: "Record",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const [first, second] = await storeTexts(["record-a1", "record-a2"]);

    const day = await recordObservation({
      experiment: experiment.id,
      observedOn: "2026-08-07",
      note: "",
      ...reading(version),
      images: [
        { unit: units.get("A-1")!, digest: first!, filename: "A-1.jpg" },
        { unit: units.get("A-2")!, digest: second!, filename: "A-2.jpg" },
      ],
    });
    expect(day.hasRecords).toBeTrue();
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map((item) => item.id)).toEqual([day.id]);
    expect(grid?.images.map((image) => image.observation)).toEqual([
      day.id,
      day.id,
    ]);

    await expect(
      recordObservation({
        experiment: experiment.id,
        observedOn: "2026-08-14",
        note: "",
        ...reading(version),
        images: [
          { unit: units.get("A-1")!, digest: first!, filename: "A-1.jpg" },
        ],
      }),
    ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);
    expect(
      (await readExperimentGrid(experiment.id))?.observations,
      "a refused photograph leaves no empty day behind",
    ).toHaveLength(1);
  });

  test("observations cannot precede inoculation at either boundary", async () => {
    const version = await trainedVersion("exp-dates");
    const experiment = await createExperiment({
      name: "Dates",
      inoculatedOn: INOCULATED,
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-07-31",
        note: "",
        ...reading(version),
      }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      (async () => {
        await (await database()).insert(experimentObservations).values({
          experimentId: experiment.id,
          id: randomUUID(),
          inoculatedOn: INOCULATED,
          observedOn: "2026-07-31",
          ...reading(version),
          countedClasses: [...SEED_DETECTOR.classes],
          note: "",
          createdAt: new Date(),
        });
      })(),
    ).rejects.toThrow();
  });

  test("the notebook stays editable after an observation is added", async () => {
    const version = await trainedVersion("exp-notebook");
    const experiment = await createExperiment({
      name: "Notebook",
      plantMaterial: "Arabidopsis",
      explantType: "Leaf discs",
      baseMedium: "MS",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });

    const added = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factor: null,
      note: "",
      replicates: 1,
    });
    expect(added.name).toBe("T1");
    const protocol = await updateExperiment({
      experiment: experiment.id,
      name: experiment.name,
      plantMaterial: experiment.plantMaterial,
      explantType: experiment.explantType,
      baseMedium: "B5",
      notes: experiment.notes,
      inoculatedOn: experiment.inoculatedOn,
      countsUnclear: experiment.countsUnclear,
    });
    expect(protocol.baseMedium).toBe("B5");
    await expect(
      updateExperiment({
        experiment: experiment.id,
        name: experiment.name,
        plantMaterial: experiment.plantMaterial,
        explantType: experiment.explantType,
        baseMedium: "B5",
        notes: experiment.notes,
        inoculatedOn: "2026-08-09",
        countsUnclear: experiment.countsUnclear,
      }),
    ).rejects.toThrow(ObservationRejectedError);

    const annotated = await updateExperiment({
      experiment: experiment.id,
      name: "Notebook, first run",
      plantMaterial: experiment.plantMaterial,
      explantType: experiment.explantType,
      baseMedium: "B5",
      notes: "Protocol note corrected",
      inoculatedOn: experiment.inoculatedOn,
      countsUnclear: true,
    });
    expect([annotated.name, annotated.notes, annotated.countsUnclear]).toEqual([
      "Notebook, first run",
      "Protocol note corrected",
      true,
    ]);

    const treatment = (await readExperimentGrid(experiment.id))!.treatments[0]!;
    const described = await updateTreatment({
      experiment: experiment.id,
      treatment: treatment.id,
      name: treatment.name,
      factor: { name: "6-BA", level: "1.0", unit: "mg/L" },
      note: "Recorded from the notebook afterwards",
    });
    expect(formatFactor(described.factor)).toBe("6-BA 1.0 mg/L");
    const renamed = await updateUnit({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      code: "A-1a",
      treatment: added.id,
    });
    expect([renamed.code, renamed.treatment]).toEqual(["A-1a", added.id]);
    await deleteUnit({
      experiment: experiment.id,
      unit: units.get("A-1")!,
    });
    expect(
      (await readExperimentGrid(experiment.id))?.units.map((unit) => unit.code),
    ).toEqual(["A-2", "T1-1"]);
  });

  test("image assignment rejects duplicate units and reused images", async () => {
    const version = await trainedVersion("exp-assignment");
    const experiment = await createExperiment({
      name: "Image assignment",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    const [first, other] = await storeTexts(["f-a1", "f-a2"]);

    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: units.get("A-1")!,
            digest: first!,
            filename: "one.jpg",
          },
          {
            unit: units.get("A-1")!,
            digest: other!,
            filename: "two.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: units.get("A-1")!,
            digest: first!,
            filename: "one.jpg",
          },
          {
            unit: units.get("A-2")!,
            digest: first!,
            filename: "two.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: randomUUID(),
            digest: first!,
            filename: "one.jpg",
          },
        ],
      }),
    ).rejects.toThrow(UnitNotFoundError);

    const assigned = await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: first!,
          filename: "IMG_0413.jpg",
        },
      ],
    });
    expect([assigned.assigned, assigned.observation.id]).toEqual([1, day7.id]);

    try {
      await assignObservationImages({
        experiment: experiment.id,
        observation: day14.id,
        images: [
          {
            unit: units.get("A-2")!,
            digest: first!,
            filename: "reuse.jpg",
          },
        ],
      });
      throw new Error("Expected reused image to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentObservationImageAlreadyUsedError);
      expect(
        (error as ExperimentObservationImageAlreadyUsedError).images,
      ).toEqual([
        {
          digest: first!,
          filename: "IMG_0413.jpg",
          unit: "A-1",
          observedOn: "2026-08-08",
        },
      ]);
    }
    expect((await readExperimentGrid(experiment.id))?.images).toHaveLength(1);
  });

  test("a filled cell can be given a different image", async () => {
    const version = await trainedVersion("exp-replace");
    const experiment = await createExperiment({
      name: "Replace image",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const [first, other, third] = await storeTexts(["r-a1", "r-a2", "r-a3"]);

    await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: first!,
          filename: "first.jpg",
        },
        {
          unit: units.get("A-2")!,
          digest: other!,
          filename: "other.jpg",
        },
      ],
    });

    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: units.get("A-1")!,
            digest: other!,
            filename: "stolen.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);

    expect(
      (
        await assignObservationImages({
          experiment: experiment.id,
          observation: day7.id,
          images: [
            {
              unit: units.get("A-1")!,
              digest: third!,
              filename: "third.jpg",
            },
          ],
        })
      ).assigned,
    ).toBe(1);

    const grid = await readExperimentGrid(experiment.id);
    const byUnit = new Map(grid!.images.map((image) => [image.unit, image]));
    expect(byUnit.get(units.get("A-1")!)?.digest).toBe(third);
    expect(byUnit.get(units.get("A-1")!)?.filename).toBe("third.jpg");
    expect(byUnit.get(units.get("A-2")!)?.digest).toBe(other);
    expect(await blobExists(imageBlobKey(first!))).toBeTrue();

    await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-2")!,
          digest: first!,
          filename: "moved.jpg",
        },
      ],
    });
    const after = await readExperimentGrid(experiment.id);
    const afterByUnit = new Map(
      after!.images.map((image) => [image.unit, image]),
    );
    expect(afterByUnit.get(units.get("A-1")!)?.digest).toBe(third);
    expect(afterByUnit.get(units.get("A-2")!)?.digest).toBe(first);
  });

  test("a photograph found unclear is marked on its image, wherever it is shown", async () => {
    const version = await trainedVersion("exp-unclear");
    const experiment = await createExperiment({
      name: "Unclear",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    // Unclear photographs do not count unless the experiment says so.
    expect(experiment.countsUnclear).toBe(false);
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const [fogged, clear] = await storeTexts(["u-a1", "u-a2"]);
    // A photograph known to be unclear is marked as it is placed.
    await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: fogged!,
          filename: "fogged.jpg",
          unclear: true,
        },
        { unit: units.get("A-2")!, digest: clear!, filename: "clear.jpg" },
      ],
    });
    const cellOf = async (id: string, unit: string) =>
      (await readExperimentGrid(id))!.images.find(
        (image) => image.unit === unit,
      )!;
    expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(true);
    expect((await cellOf(experiment.id, units.get("A-2")!)).unclear).toBe(
      false,
    );
    const page = await readUnit({
      experiment: experiment.id,
      unit: units.get("A-1")!,
    });
    expect(page?.shown?.unclear).toBe(true);
    expect(page?.observations[0]?.image?.unclear).toBe(true);

    // Marking again is harmless; the image is not read again.
    expect(await markImageUnclear({ digest: fogged! })).toEqual({
      digest: fogged,
      marked: false,
    });

    // The mark is the image's: another experiment showing it shows the mark.
    const other = await createExperiment({
      name: "Unclear elsewhere",
      inoculatedOn: INOCULATED,
      countsUnclear: true,
    });
    expect(other.countsUnclear).toBe(true);
    const otherUnits = await unitsOf(other.id);
    const otherDay = await addObservation({
      experiment: other.id,
      observedOn: "2026-08-09",
      note: "",
      ...reading(version),
    });
    await assignObservationImages({
      experiment: other.id,
      observation: otherDay.id,
      images: [
        { unit: otherUnits.get("A-1")!, digest: fogged!, filename: "f.jpg" },
      ],
    });
    expect((await cellOf(other.id, otherUnits.get("A-1")!)).unclear).toBe(true);

    // Clearing makes it clear again, and clearing twice is harmless.
    expect(await clearImageUnclear({ digest: fogged! })).toEqual({
      digest: fogged,
      cleared: true,
    });
    expect(await clearImageUnclear({ digest: fogged! })).toEqual({
      digest: fogged,
      cleared: false,
    });
    expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(
      false,
    );

    const unknown = "f".repeat(64);
    await expect(markImageUnclear({ digest: unknown })).rejects.toThrow(
      ImageNotFoundError,
    );
    await expect(clearImageUnclear({ digest: unknown })).rejects.toThrow(
      ImageNotFoundError,
    );
  });

  test("an unclear mark keeps no image alive", async () => {
    const [loose] = await storeTexts(["unclear-loose"]);
    await markImageUnclear({ digest: loose! });
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await collectImages(later)).toContain(loose!);
  });

  test("an assignment can be unassigned and the image given to another unit", async () => {
    const version = await trainedVersion("exp-unassign");
    const experiment = await createExperiment({
      name: "Refile",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const [first, other] = await storeTexts(["w-a1", "w-a2"]);
    await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: first!,
          filename: "A-1.jpg",
        },
        {
          unit: units.get("A-2")!,
          digest: other!,
          filename: "A-2.jpg",
        },
      ],
    });
    const images = await imagesByUnit(experiment.id);

    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            unit: units.get("A-2")!,
            digest: first!,
            filename: "A-1.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ExperimentObservationImageAlreadyUsedError);

    await unassignObservationImage({
      experiment: experiment.id,
      observationImage: images.get("A-2")!,
    });
    await unassignObservationImage({
      experiment: experiment.id,
      observationImage: images.get("A-1")!,
    });
    await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          unit: units.get("A-2")!,
          digest: first!,
          filename: "A-1.jpg",
        },
      ],
    });

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.images.map((image) => image.unit)).toEqual([
      units.get("A-2")!,
    ]);
    expect(
      await blobExists(imageBlobKey(await imageDigest("w-a2"))),
    ).toBeTrue();
  });

  test("at most one terminal event", async () => {
    const version = await trainedVersion("exp-terminal-events");
    const experiment = await createExperiment({
      name: "Terminal events",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 1 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });

    const results = await Promise.allSettled([
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-1")!,
        type: "discarded",
        observation: day7.id,
      }),
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-1")!,
        type: "harvested",
        observation: day7.id,
      }),
    ]);
    const recorded = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(recorded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(UnitRejectedError);

    await deleteCultureEvent({
      experiment: experiment.id,
      event: recorded[0]!.value.id,
    });
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-1")!,
        type: "missing",
        observation: day7.id,
      }),
    ).resolves.toMatchObject({ type: "missing" });
  });

  test("culture events take effect until they are removed", async () => {
    const version = await trainedVersion("exp-missing");
    const experiment = await createExperiment({
      name: "Contamination",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });

    const event = await recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "contaminated",
      observation: day7.id,
    });
    expect([event.type, event.observation]).toEqual(["contaminated", day7.id]);
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-1")!,
        type: "contaminated",
        observation: day7.id,
      }),
    ).rejects.toThrow(UnitRejectedError);

    await deleteCultureEvent({ experiment: experiment.id, event: event.id });

    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    const terminalEvent = await recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-1")!,
      type: "discarded",
      observation: day7.id,
    });
    const [futurePhoto] = await storeTexts(["terminal-a1"]);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day14.id,
        images: [
          {
            unit: units.get("A-1")!,
            digest: futurePhoto!,
            filename: "A1.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await deleteCultureEvent({
      experiment: experiment.id,
      event: terminalEvent.id,
    });
    await assignObservationImages({
      experiment: experiment.id,
      observation: day14.id,
      images: [
        {
          unit: units.get("A-1")!,
          digest: futurePhoto!,
          filename: "A1.jpg",
        },
      ],
    });

    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-1")!,
        type: "harvested",
        observation: day7.id,
      }),
    ).rejects.toThrow("has records after this observation");

    await recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-2")!,
      type: "contaminated",
      observation: day14.id,
    });
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit: units.get("A-2")!,
        type: "discarded",
        observation: day7.id,
      }),
    ).rejects.toThrow("has records after this observation");

    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit: randomUUID(),
        type: "missing",
        observation: day7.id,
      }),
    ).rejects.toThrow(UnitNotFoundError);

    const rows = await (
      await database()
    )
      .select()
      .from(experimentCultureEvents);
    expect(rows.some((row) => row.id === event.id)).toBeFalse();
  });

  test("the same culture event can be recorded on several units", async () => {
    const version = await trainedVersion("exp-bulk-events");
    const experiment = await createExperiment({
      name: "Bulk events",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 3 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });

    const events = await recordCultureEvents({
      experiment: experiment.id,
      units: [units.get("A-1")!, units.get("A-2")!],
      type: "contaminated",
      observation: day7.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "contaminated",
      "contaminated",
    ]);

    await expect(
      recordCultureEvents({
        experiment: experiment.id,
        units: [units.get("A-2")!, units.get("A-3")!],
        type: "contaminated",
        observation: day7.id,
      }),
    ).rejects.toThrow(UnitRejectedError);
    expect(
      (await readExperimentGrid(experiment.id))?.units.filter((unit) =>
        unit.events.some((event) => event.type === "contaminated"),
      ),
    ).toHaveLength(2);
  });

  test("analyzes images for the observation's model and exposes tallies", async () => {
    const version = await trainedVersion("exp-metrics");
    const experiment = await createExperiment({
      name: "Metrics",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "D", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignImages(experiment.id, day7.id, units, {
      "D-1": "c-d1",
      "D-2": "c-d2",
    });
    const d1 = await imageDigest("c-d1");
    const d2 = await imageDigest("c-d2");

    const stateOf = async (digest: string) =>
      (await readExperimentGrid(experiment.id))?.images.find(
        (image) => image.digest === digest,
      )?.state;
    expect([await stateOf(d1), await stateOf(d2)]).toEqual([
      "pending",
      "pending",
    ]);

    await seedDetectionResult(
      { versionId: version.id, digest: d1 },
      resultFor(version, d1, 3),
      worker,
    );
    await seedInferenceTaskFailure(
      { versionId: version.id, digest: d2 },
      "no unit found",
    );
    const grid = await readExperimentGrid(experiment.id);
    const codes = new Map(grid!.units.map((unit) => [unit.id, unit.code]));
    expect(
      grid?.images
        .map((image) => [
          codes.get(image.unit)!,
          image.state,
          image.detectionTally,
          image.error,
        ])
        .sort(),
    ).toEqual([
      ["D-1", "analyzed", { ungerminated: 3 }, null],
      ["D-2", "failed", null, "no unit found"],
    ]);

    const images = await imagesByUnit(experiment.id);
    const failed = {
      experiment: experiment.id,
      observationImage: images.get("D-2")!,
    };
    await retryObservationImageAnalysis(failed);
    expect(await stateOf(d2)).toBe("pending");
    expect((await readExperimentObservationImage(failed))?.failure).toBeNull();
    expect(
      (await readExperimentObservationImage(failed))?.observation.observedOn,
    ).toBe("2026-08-08");
    expect((await readExperimentObservationImage(failed))?.unit.code).toBe(
      "D-2",
    );
    expect(
      (
        await readExperimentObservationImage({
          experiment: experiment.id,
          observationImage: images.get("D-1")!,
        })
      )?.review.detection?.instances,
    ).toHaveLength(3);
  });

  test("a unit page shows its newest image and steps through units on its day", async () => {
    const version = await trainedVersion("exp-observation-unit");
    const experiment = await createExperiment({
      name: "Unit series",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "S", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    await assignImages(experiment.id, day7.id, units, {
      "S-1": "s-d1-s1",
      "S-2": "s-d1-s2",
    });
    await assignImages(experiment.id, day14.id, units, {
      "S-1": "s-d3-s1",
    });
    const ref = {
      experiment: experiment.id,
      unit: units.get("S-1")!,
    };

    const newest = await readUnit(ref);
    expect(newest?.shown?.model.classes).toEqual(SEED_DETECTOR.classes);
    expect(newest?.shown?.observation.id).toBe(day14.id);
    expect(
      newest?.observations.map((item) => item.image?.state ?? null),
    ).toEqual(["pending", "pending"]);
    // Each day's photograph carries its size, to be framed beside another.
    const latest = newest?.observations[1]?.image;
    expect(latest && [latest.width, latest.height]).toEqual([
      newest!.shown!.review.width,
      newest!.shown!.review.height,
    ]);
    expect(newest?.observation).toBe(day14.id);
    expect(newest?.navigation.map((item) => [item.code, item.image])).toEqual([
      ["S-1", "unreviewed"],
      ["S-2", null],
    ]);

    const earlier = await readUnit(ref, day7.id);
    expect(earlier?.shown?.review.ref.digest).toBe(
      await imageDigest("s-d1-s1"),
    );

    const lonely = await readUnit({
      ...ref,
      unit: units.get("S-2")!,
    });
    expect(lonely?.shown?.observation.id).toBe(day7.id);
    expect(lonely?.observations[1]?.image).toBeNull();
    const missing = await readUnit(
      { ...ref, unit: units.get("S-2")! },
      day14.id,
    );
    expect(missing?.observation).toBe(day14.id);
    expect(missing?.shown).toBeNull();
    expect(await readUnit(ref, randomUUID())).toBeNull();
    expect(
      await readUnit({
        ...ref,
        unit: randomUUID(),
      }),
    ).toBeNull();
  });

  test("images keep their units, and experiments without them can be deleted", async () => {
    const version = await trainedVersion("exp-maint");
    const experiment = await createExperiment({
      name: "Draft",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const revised = await updateExperiment({
      experiment: experiment.id,
      name: "Final",
      plantMaterial: "Tobacco BY-2",
      explantType: "Leaf discs",
      baseMedium: "MS + 3% sucrose",
      notes: "Draft protocol",
      inoculatedOn: "2026-08-02",
      countsUnclear: false,
    });
    expect([revised.name, revised.inoculatedOn]).toEqual([
      "Final",
      "2026-08-02",
    ]);

    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    await assignImages(experiment.id, day7.id, units, {
      "A-1": "m-a1-1",
      "A-2": "m-a2-1",
    });
    await expect(
      updateObservation({
        experiment: experiment.id,
        observation: day14.id,
        observedOn: "2026-08-08",
        note: "",
        ...reading(version),
        countedClasses: day14.countedClasses,
      }),
    ).rejects.toThrow(ObservationRejectedError);
    const redatedEmpty = await updateObservation({
      experiment: experiment.id,
      observation: day14.id,
      observedOn: "2026-08-29",
      note: "Final count",
      ...reading(version),
      countedClasses: day14.countedClasses,
    });
    expect([redatedEmpty.observedOn, redatedEmpty.note]).toEqual([
      "2026-08-29",
      "Final count",
    ]);
    const redatedRecorded = await updateObservation({
      experiment: experiment.id,
      observation: day7.id,
      observedOn: "2026-08-09",
      note: "Images checked",
      ...reading(version),
      countedClasses: day7.countedClasses,
    });
    expect([redatedRecorded.observedOn, redatedRecorded.note]).toEqual([
      "2026-08-09",
      "Images checked",
    ]);
    expect((await readExperimentGrid(experiment.id))?.images).toHaveLength(2);

    await deleteObservation({
      experiment: experiment.id,
      observation: day14.id,
    });
    await expect(
      deleteObservation({ experiment: experiment.id, observation: day7.id }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      deleteUnit({
        experiment: experiment.id,
        unit: units.get("A-2")!,
      }),
    ).rejects.toThrow(UnitRejectedError);
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map((item) => item.id)).toEqual([day7.id]);
    expect(grid?.units.map((unit) => unit.code)).toEqual(["A-1", "A-2"]);
    expect(grid?.images).toHaveLength(2);
    const first = await imageDigest("m-a1-1");
    expect(await blobExists(imageBlobKey(first))).toBeTrue();

    await expect(
      deleteExperiment({ experiment: experiment.id }),
    ).rejects.toThrow(ExperimentHasRecordsError);

    const disposable = await createExperiment({
      name: "Disposable draft",
      inoculatedOn: INOCULATED,
    });
    await deleteExperiment({ experiment: disposable.id });
    expect(await readExperimentGrid(disposable.id)).toBeNull();
    await expect(
      deleteExperiment({ experiment: disposable.id }),
    ).rejects.toThrow(ExperimentNotFoundError);
    expect(await blobExists(imageBlobKey(first))).toBeTrue();
  });

  test("two experiments analyzing one image with one version share one inference", async () => {
    const version = await trainedVersion("exp-shared");
    const [digest] = await storeTexts(["shared-image"]);
    const experimentIds: string[] = [];
    for (const name of ["Shared demand A", "Shared demand B"]) {
      const experiment = await createExperiment({
        name,
        inoculatedOn: INOCULATED,
        treatments: [{ name: "S", replicates: 1 }],
      });
      const units = await unitsOf(experiment.id);
      const observation = await addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
        ...reading(version),
      });
      await assignObservationImages({
        experiment: experiment.id,
        observation: observation.id,
        images: [
          {
            unit: units.get("S-1")!,
            digest: digest!,
            filename: "S1.jpg",
          },
        ],
      });
      experimentIds.push(experiment.id);
    }

    const states = async () =>
      Promise.all(
        experimentIds.map(
          async (id) => (await readExperimentGrid(id))?.images[0]?.state,
        ),
      );
    expect(await states()).toEqual(["pending", "pending"]);

    await seedDetectionResult(
      { versionId: version.id, digest: digest! },
      resultFor(version, digest!, 1),
      worker,
    );
    expect(await states()).toEqual(["analyzed", "analyzed"]);
  });

  test("the database refuses execution failures in the detection results", async () => {
    const version = await trainedVersion("exp-failure-fk");
    const [digest] = await storeTexts(["failure-fk"]);
    const failure = failureFor(version, digest!);

    const invalidFailure = (async () => {
      await (await database()).insert(inferenceOutcomes).values({
        imageId: digest!,
        modelVersionId: version.id,
        document: {
          ...failure,
          producer: failure.producer,
        } as never,
        recordedAt: new Date(),
      });
    })();
    await expect(invalidFailure).rejects.toThrow();
  });

  test("an experiment observation image is a garbage-collection root", async () => {
    const version = await trainedVersion("exp-gc");
    const experiment = await createExperiment({
      name: "GC",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "E", replicates: 1 }],
    });
    const units = await unitsOf(experiment.id);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignImages(experiment.id, observation.id, units, {
      "E-1": "gc-e1",
    });
    const kept = await imageDigest("gc-e1");
    const [loose] = await storeTexts(["gc-loose"]);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const collected = await collectImages(later);

    expect(collected).toContain(loose!);
    expect(collected).not.toContain(kept);
    expect(await blobExists(imageBlobKey(kept))).toBeTrue();
  });
});

describe("counts entered by hand", () => {
  test("a unit counted by hand has a number with no photograph, and the count outranks the photograph's", async () => {
    const version = await trainedVersion("exp-manual-counts");
    const experiment = await createExperiment({
      name: "Transplanting counts",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day0 = await addObservation({
      experiment: experiment.id,
      observedOn: INOCULATED,
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
      countedClasses: ["germinated"],
    });
    await assignImages(experiment.id, day0.id, units, { "A-1": "m-a1" });
    const a1 = await imageDigest("m-a1");
    await seedDetectionResult(
      { versionId: version.id, digest: a1 },
      resultFor(version, a1, 3),
      worker,
    );

    // The day the seedlings were moved was never photographed; the counts
    // taken at the bench stand for it.
    const readings = await recordManualReadings({
      experiment: experiment.id,
      observation: day14.id,
      readings: [
        { unit: units.get("A-1")!, tally: { germinated: 17 } },
        { unit: units.get("A-2")!, tally: { germinated: 12 } },
      ],
    });
    expect(readings.map((item) => [item.unit, item.tally]).sort()).toEqual(
      [
        [units.get("A-1")!, { germinated: 17 }],
        [units.get("A-2")!, { germinated: 12 }],
      ].sort(),
    );

    const grid = (await readExperimentGrid(experiment.id))!;
    expect(
      grid.observations.map((item) => [item.observedOn, item.hasRecords]),
    ).toEqual([
      [INOCULATED, true],
      ["2026-08-15", true],
    ]);
    const cells = observationCells(grid.images, grid.manualReadings);
    expect(unitReading(cells, units.get("A-1")!, day14)).toEqual({
      count: 17,
      source: "manual",
    });
    expect(unitReading(cells, units.get("A-2")!, day14)).toEqual({
      count: 12,
      source: "manual",
    });
    expect(unitReading(cells, units.get("A-1")!, day0)).toEqual({
      count: 3,
      source: "detection",
    });

    // A person who counted the photographed dish is believed over the detector.
    await recordManualReadings({
      experiment: experiment.id,
      observation: day0.id,
      readings: [
        {
          unit: units.get("A-1")!,
          tally: { ungerminated: 4, germinated: 0 },
        },
      ],
    });
    const recounted = (await readExperimentGrid(experiment.id))!;
    expect(
      unitReading(
        observationCells(recounted.images, recounted.manualReadings),
        units.get("A-1")!,
        day0,
      ),
    ).toEqual({ count: 4, source: "manual" });
    expect(recounted.images).toHaveLength(1);

    // The unit's page carries the count on a day it has no photograph of.
    const series = (await readUnit(
      { experiment: experiment.id, unit: units.get("A-2")! },
      day14.id,
    ))!;
    expect(
      series.observations.map((item) => [item.image, item.manual?.tally]),
    ).toEqual([
      [null, undefined],
      [null, { germinated: 12 }],
    ]);
    expect(series.shown).toBeNull();

    // A count is replaced by entering it again, and withdrawn by entering nothing.
    await recordManualReadings({
      experiment: experiment.id,
      observation: day14.id,
      readings: [
        { unit: units.get("A-1")!, tally: { germinated: 18 } },
        { unit: units.get("A-2")!, tally: null },
      ],
    });
    const corrected = (await readExperimentGrid(experiment.id))!;
    expect(
      corrected.manualReadings
        .filter((item) => item.observation === day14.id)
        .map((item) => [item.unit, item.tally]),
    ).toEqual([[units.get("A-1")!, { germinated: 18 }]]);
  });

  test("a count answers the day's question in the model's classes", async () => {
    const version = await trainedVersion("exp-manual-classes");
    const experiment = await createExperiment({
      name: "Manual classes",
      inoculatedOn: INOCULATED,
    });
    const units = await unitsOf(experiment.id);
    const day0 = await addObservation({
      experiment: experiment.id,
      observedOn: INOCULATED,
      note: "",
      ...reading(version),
    });
    const unit = units.get("A-1")!;
    await expect(
      recordManualReadings({
        experiment: experiment.id,
        observation: day0.id,
        readings: [{ unit, tally: { ungerminated: 4, shoots: 1 } }],
      }),
    ).rejects.toThrow(ManualReadingRejectedError);
    // Every class the day counts must be given: a class left out is not zero.
    await expect(
      recordManualReadings({
        experiment: experiment.id,
        observation: day0.id,
        readings: [{ unit, tally: { germinated: 4 } }],
      }),
    ).rejects.toThrow(ManualReadingRejectedError);
    await expect(
      recordManualReadings({
        experiment: experiment.id,
        observation: day0.id,
        readings: [
          { unit: randomUUID(), tally: { ungerminated: 4, germinated: 0 } },
        ],
      }),
    ).rejects.toThrow(UnitNotFoundError);
    await expect(
      recordManualReadings({
        experiment: experiment.id,
        observation: randomUUID(),
        readings: [{ unit, tally: { ungerminated: 4, germinated: 0 } }],
      }),
    ).rejects.toThrow(ObservationNotFoundError);
    expect((await readExperimentGrid(experiment.id))!.manualReadings).toEqual(
      [],
    );
  });

  test("a count is a record: it keeps its observation and unit, and holds a unit on the bench", async () => {
    const version = await trainedVersion("exp-manual-records");
    const experiment = await createExperiment({
      name: "Manual records",
      inoculatedOn: INOCULATED,
      treatments: [{ name: "A", replicates: 2 }],
    });
    const units = await unitsOf(experiment.id);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
      ...reading(version),
    });
    const unit = units.get("A-1")!;
    await recordManualReadings({
      experiment: experiment.id,
      observation: day14.id,
      readings: [{ unit, tally: { ungerminated: 2, germinated: 9 } }],
    });

    await expect(
      deleteObservation({ experiment: experiment.id, observation: day14.id }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      deleteUnit({ experiment: experiment.id, unit }),
    ).rejects.toThrow(UnitRejectedError);
    // A dish counted on day 14 was still on the bench then.
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        unit,
        type: "discarded",
        observation: day7.id,
      }),
    ).rejects.toThrow(UnitRejectedError);

    // A dish that left the bench cannot be counted afterwards.
    await recordCultureEvent({
      experiment: experiment.id,
      unit: units.get("A-2")!,
      type: "discarded",
      observation: day7.id,
    });
    await expect(
      recordManualReadings({
        experiment: experiment.id,
        observation: day14.id,
        readings: [
          {
            unit: units.get("A-2")!,
            tally: { ungerminated: 0, germinated: 1 },
          },
        ],
      }),
    ).rejects.toThrow(ManualReadingRejectedError);

    // Withdrawing the count frees the observation and the unit again.
    await recordManualReadings({
      experiment: experiment.id,
      observation: day14.id,
      readings: [{ unit, tally: null }],
    });
    await deleteObservation({
      experiment: experiment.id,
      observation: day14.id,
    });
    await deleteUnit({ experiment: experiment.id, unit });
  });
});

test("correcting dates cannot move records beyond a unit's removal", async () => {
  const version = await trainedVersion("date-lifetime");
  const experiment = await createExperiment({
    name: "Date lifetime",
    inoculatedOn: INOCULATED,
  });
  const units = await unitsOf(experiment.id);
  const unit = units.get("A-1")!;
  const counted = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const removed = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    ...reading(version),
  });
  await recordManualReadings({
    experiment: experiment.id,
    observation: counted.id,
    readings: [{ unit, tally: { ungerminated: 2, germinated: 3 } }],
  });
  await recordCultureEvent({
    experiment: experiment.id,
    unit,
    observation: removed.id,
    type: "discarded",
  });
  for (const [observation, observedOn] of [
    [counted, "2026-08-20"],
    [removed, "2026-08-05"],
  ] as const) {
    await expect(
      updateObservation({
        experiment: experiment.id,
        observation: observation.id,
        observedOn,
        note: "",
        ...reading(version),
        countedClasses: observation.countedClasses,
      }),
    ).rejects.toThrow(UnitRejectedError);
    const grid = (await readExperimentGrid(experiment.id))!;
    expect(
      grid.observations.find((item) => item.id === observation.id)!.observedOn,
    ).toBe(observation.observedOn);
  }
  const corrected = await updateObservation({
    experiment: experiment.id,
    observation: counted.id,
    observedOn: "2026-08-09",
    note: "",
    ...reading(version),
    countedClasses: counted.countedClasses,
  });
  expect(corrected.observedOn).toBe("2026-08-09");
});

test("a new model cannot reinterpret existing manual counts", async () => {
  const version = await trainedVersion("manual-model-identity");
  const experiment = await createExperiment({
    name: "Manual model identity",
    inoculatedOn: INOCULATED,
  });
  const unit = (await unitsOf(experiment.id)).get("A-1")!;
  const observation = await addObservation({
    experiment: experiment.id,
    observedOn: INOCULATED,
    note: "",
    ...reading(version),
  });
  const other = await createModel({
    id: "other-manual-model",
    name: "Other meaning",
    classes: ["ungerminated", "germinated"],
  });
  await recordManualReadings({
    experiment: experiment.id,
    observation: observation.id,
    readings: [{ unit, tally: { ungerminated: 4, germinated: 1 } }],
  });
  const update = {
    experiment: experiment.id,
    observation: observation.id,
    observedOn: INOCULATED,
    note: "",
    modelId: other.id,
    countedClasses: other.classes,
  };
  await expect(updateObservation(update)).rejects.toThrow(
    ObservationModelHasCountsError,
  );
  const grid = (await readExperimentGrid(experiment.id))!;
  expect(grid.observations[0]!.modelId).toBe(version.modelId);
  expect(grid.manualReadings[0]!.tally).toEqual({
    ungerminated: 4,
    germinated: 1,
  });
  const recounted = await updateObservation({
    ...update,
    modelId: version.modelId,
    countedClasses: ["germinated"],
  });
  expect(recounted.countedClasses).toEqual(["germinated"]);
  await recordManualReadings({
    experiment: experiment.id,
    observation: observation.id,
    readings: [{ unit, tally: null }],
  });
  expect((await updateObservation(update)).modelId).toBe(other.id);
});
