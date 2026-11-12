import { expect, test } from "bun:test";
import postgres from "postgres";

import {
  SEED_DETECTOR_BASELINE_VERSION_ID,
  SEED_DETECTOR_MODEL_ID,
} from "../../domain/models/builtins";
import {
  ClassInvalidError,
  ModelNameTakenError,
  ModelNotFoundError,
  ModelUsageConflictError,
  ModelVersionNotFoundError,
} from "../../domain/models/errors";
import {
  DEFAULT_MODEL_ANNOTATION,
  modelVersionSchema,
  sameModelVersion,
} from "../../domain/models/schema";
import { storeAnnotation } from "../annotations/public";
import { unassignObservationImage } from "../experiments/observation-images";
import { deleteObservation } from "../experiments/public";
import { database } from "../infra/db/client";
import { connect } from "../infra/db/connection";
import { modelVersions } from "../infra/db/schema";
import { observeImagesForModel } from "../testing/experiments";
import { registerTrainedVersion, traditionalVersion } from "../testing/models";
import {
  createModel,
  deleteModel,
  installBuiltinModels,
  listModels,
  listModelVersions,
  readCurrentVersionId,
  readModelVersion,
  registerModel,
  registerModelVersion,
  setCurrentVersion,
  setModelSettings,
} from "./registry";

test("a version is registered once and its contents may not change", async () => {
  const model = await registerModel(
    {
      schemaVersion: 1,
      id: "registry-detector",
      name: "Registry detector",
      task: "object_detection",
      classes: ["seed"],
      countedClasses: ["seed"],
      area: "image",
      annotation: DEFAULT_MODEL_ANNOTATION,
    },
    await database(),
  );
  const candidate = {
    schemaVersion: 1 as const,
    id: "registry-detector-v1",
    modelId: model.id,
    classes: model.classes,
    createdAt: "2026-08-27T00:00:00.000Z",
    source: {
      kind: "builtin" as const,
      definition: "registry-v1",
    },
    artifact: {
      kind: "traditional" as const,
      digest: "d".repeat(64),
    },
  };
  const version = await registerModelVersion(candidate, await database());

  expect(await listModels()).toContainEqual(model);
  expect(await readModelVersion(version.id, await database())).toEqual(version);
  expect(
    sameModelVersion(version, {
      artifact: candidate.artifact,
      source: candidate.source,
      createdAt: candidate.createdAt,
      classes: candidate.classes,
      modelId: candidate.modelId,
      id: candidate.id,
      schemaVersion: candidate.schemaVersion,
    }),
  ).toBeTrue();
  expect(
    modelVersionSchema.safeParse({
      ...candidate,
      artifact: {
        kind: "ultralytics",
        digest: "c".repeat(64),
        weights: { digest: "c".repeat(64), bytes: 10 },
      },
    }).success,
  ).toBeFalse();
  await expect(
    registerModelVersion(
      {
        ...candidate,
        artifact: { ...candidate.artifact, digest: "e".repeat(64) },
      },
      await database(),
    ),
  ).rejects.toThrow(/already registered with different contents/);
});

test("a version finds only classes its model declares, in the model's order", async () => {
  const db = await database();
  const model = await registerModel(
    {
      schemaVersion: 1,
      id: "class-bound-detector",
      name: "Class-bound detector",
      task: "object_detection",
      classes: ["seed", "germinated", "dead"],
      countedClasses: ["seed", "germinated", "dead"],
      area: "image",
      annotation: DEFAULT_MODEL_ANNOTATION,
    },
    db,
  );
  const version = (suffix: string, classes: string[]) => ({
    schemaVersion: 1 as const,
    id: `class-bound-detector-${suffix}`,
    modelId: model.id,
    classes,
    createdAt: "2026-08-27T00:00:00.000Z",
    source: { kind: "builtin" as const, definition: `class-bound-${suffix}` },
    artifact: { kind: "traditional" as const, digest: "d".repeat(64) },
  });

  const fewer = await registerModelVersion(version("fewer", ["seed"]), db);
  expect(fewer.classes).toEqual(["seed"]);
  expect(await readModelVersion(fewer.id, db)).toEqual(fewer);
  await expect(
    registerModelVersion(version("unknown", ["seed", "shoot"]), db),
  ).rejects.toThrow(/declares, in its order/);
  await expect(
    registerModelVersion(version("reordered", ["dead", "seed"]), db),
  ).rejects.toThrow(/declares, in its order/);
});

test("every registered version is listed newest first", async () => {
  const model = await registerModel(
    {
      schemaVersion: 1,
      id: "listing-detector",
      name: "Listing detector",
      task: "object_detection",
      classes: ["seed"],
      countedClasses: ["seed"],
      area: "image",
      annotation: DEFAULT_MODEL_ANNOTATION,
    },
    await database(),
  );
  const version = (createdAt: string, suffix: string) => ({
    schemaVersion: 1 as const,
    id: `listing-detector-${suffix}`,
    modelId: model.id,
    classes: model.classes,
    createdAt,
    source: { kind: "builtin" as const, definition: `listing-${suffix}` },
    artifact: { kind: "traditional" as const, digest: "d".repeat(64) },
  });
  const older = await registerModelVersion(
    version("2026-08-27T00:00:00.000Z", "v1"),
    await database(),
  );
  const newer = await registerModelVersion(
    version("2026-08-28T00:00:00.000Z", "v2"),
    await database(),
  );

  const listed = (await listModelVersions(model.id)).map(({ id }) => id);
  expect(listed).toContain(older.id);
  expect(listed.indexOf(newer.id)).toBeLessThan(listed.indexOf(older.id));
});

test("a task exists as soon as it is named, before anything can answer it", async () => {
  const model = await createModel({
    id: "germination-detector",
    name: "Germination detector",
    classes: ["germinated"],
  });
  expect(model).toEqual({
    schemaVersion: 1,
    id: "germination-detector",
    name: "Germination detector",
    task: "object_detection",
    classes: ["germinated"],
    countedClasses: ["germinated"],
    area: "image",
    annotation: DEFAULT_MODEL_ANNOTATION,
  });
  const framed = await setModelSettings({
    model: model.id,
    countedClasses: model.countedClasses,
    area: "dish",
    annotation: { ...DEFAULT_MODEL_ANNOTATION, instructions: "Box seeds" },
  });
  expect(framed.area).toBe("dish");
  expect(framed.annotation.instructions).toBe("Box seeds");
  // Registration supplies a starting point; the deployment's settings stay.
  expect(
    await registerModel(
      { ...model, area: "image", annotation: DEFAULT_MODEL_ANNOTATION },
      await database(),
    ),
  ).toEqual(framed);
  await expect(
    registerModel({ ...model, classes: ["seed"] }, await database()),
  ).rejects.toThrow(/different contents/);
  expect((await listModels()).map(({ id }) => id)).toContain(
    "germination-detector",
  );
  expect(await listModelVersions("germination-detector")).toEqual([]);

  await expect(
    createModel({
      id: "germination-detector",
      name: "Something else",
      classes: ["seed"],
    }),
  ).rejects.toBeInstanceOf(ModelNameTakenError);
});

test("a task counts every class by default unless it names fewer, and the default is a setting", async () => {
  const request = {
    id: "state-detector",
    name: "State detector",
    classes: ["seed", "germinated", "empty"],
  };
  await expect(
    createModel({ ...request, countedClasses: ["seed", "shoot"] }),
  ).rejects.toBeInstanceOf(ClassInvalidError);
  const model = await createModel({
    ...request,
    countedClasses: ["germinated", "seed"],
  });
  expect(model.countedClasses).toEqual(["seed", "germinated"]);

  const settings = {
    model: model.id,
    area: model.area,
    annotation: model.annotation,
  };
  await expect(
    setModelSettings({ ...settings, countedClasses: ["shoot"] }),
  ).rejects.toBeInstanceOf(ClassInvalidError);
  const every = await setModelSettings({
    ...settings,
    countedClasses: ["empty", "germinated", "seed"],
  });
  expect(every.countedClasses).toEqual(model.classes);
  // Registration supplies a starting point; the deployment's setting stays.
  expect(await registerModel(model, await database())).toEqual(every);
});

test("a task nothing records against can be withdrawn", async () => {
  await createModel({
    id: "withdrawn-detector",
    name: "Withdrawn detector",
    classes: ["seed"],
  });
  await deleteModel({ model: "withdrawn-detector" });
  expect((await listModels()).map(({ id }) => id)).not.toContain(
    "withdrawn-detector",
  );

  await expect(
    deleteModel({ model: "withdrawn-detector" }),
  ).rejects.toBeInstanceOf(ModelNotFoundError);
  await expect(
    deleteModel({ model: SEED_DETECTOR_MODEL_ID }),
  ).rejects.toBeInstanceOf(ModelUsageConflictError);
});

test("a review outliving its observation still holds its model", async () => {
  const modelId = "reviewed-detector";
  await createModel({
    id: modelId,
    name: "Reviewed detector",
    classes: ["seed"],
  });
  const observed = await observeImagesForModel(
    "Reviewed images",
    ["reviewed"],
    modelId,
  );
  await storeAnnotation({ digest: observed.digests[0]!, modelId }, [], null);
  await unassignObservationImage(observed.images[0]!);
  await deleteObservation({
    experiment: observed.experiment.id,
    observation: observed.observation.id,
  });

  await expect(deleteModel({ model: modelId })).rejects.toBeInstanceOf(
    ModelUsageConflictError,
  );
});

/**
 * Two sessions can only meet on a real server, so the database a run is pointed
 * at decides whether the contended withdrawal is exercised.
 */
const testDatabaseUrl = process.env.SEEDBUDDY_TEST_DATABASE_URL;
const contendedTest = testDatabaseUrl ? test : test.skip;

/** Returns once a session is waiting on a lock another session holds. */
async function waitForLockContention(url: string): Promise<void> {
  const observer = postgres(url, { max: 1, onnotice: () => {} });
  try {
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    const deadline = Date.now() + 5_000;
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    while (Date.now() < deadline) {
      const [waiting] = await observer<{ sessions: number }[]>`
        select count(*)::int as sessions from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `;
      if ((waiting?.sessions ?? 0) > 0) return;
      await Bun.sleep(10);
    }
    throw new Error("The withdrawal never waited for the model row");
  } finally {
    await observer.end();
  }
}

contendedTest(
  "a version recorded while a withdrawal waits still holds the model",
  async () => {
    const model = await registerModel(
      {
        schemaVersion: 1,
        id: "contended-detector",
        name: "Contended detector",
        task: "object_detection",
        classes: ["seed"],
        countedClasses: ["seed"],
        area: "image",
        annotation: DEFAULT_MODEL_ANNOTATION,
      },
      await database(),
    );
    const other = await connect(testDatabaseUrl!);
    let record = (): void => {};
    let commit = (): void => {};
    const recorded = new Promise<void>((resolve) => {
      record = resolve;
    });
    const committed = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const recording = other.db.transaction(async (db) => {
      await db.insert(modelVersions).values({
        id: "contended-detector-v1",
        modelId: model.id,
        classes: model.classes,
        createdAt: new Date("2026-09-11T00:00:00.000Z"),
        source: { kind: "builtin", definition: "contended-v1" },
        artifact: { kind: "traditional", digest: "f".repeat(64) },
      });
      record();
      await committed;
    });

    try {
      await recorded;
      const withdrawal = deleteModel({ model: model.id });
      await waitForLockContention(testDatabaseUrl!);
      commit();
      await recording;
      await expect(withdrawal).rejects.toBeInstanceOf(ModelUsageConflictError);
    } finally {
      commit();
      await recording.catch(() => {});
      await other.close();
    }

    expect((await listModels()).map(({ id }) => id)).toContain(model.id);
  },
);

test("the current version is one of the model's own, and a restart keeps the one chosen", async () => {
  const other = await traditionalVersion("registry-other", "other-v1");
  await expect(
    setCurrentVersion({ model: SEED_DETECTOR_MODEL_ID, version: other.id }),
  ).rejects.toBeInstanceOf(ModelVersionNotFoundError);

  const trained = await registerTrainedVersion(
    SEED_DETECTOR_MODEL_ID,
    "registry-restart",
  );
  await setCurrentVersion({
    model: SEED_DETECTOR_MODEL_ID,
    version: trained.id,
  });
  try {
    await installBuiltinModels(await database());
    expect(
      await readCurrentVersionId(SEED_DETECTOR_MODEL_ID, await database()),
    ).toBe(trained.id);
  } finally {
    await setCurrentVersion({
      model: SEED_DETECTOR_MODEL_ID,
      version: SEED_DETECTOR_BASELINE_VERSION_ID,
    });
  }
});
