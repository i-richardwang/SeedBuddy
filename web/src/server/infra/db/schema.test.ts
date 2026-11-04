import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { recordCultureEvents } from "../../experiments/culture-events";
import { createExperiment } from "../../experiments/design";
import { createObservation } from "../../experiments/observations";
import { listTreatments, listUnits } from "../../experiments/records";
import { storeTexts } from "../../testing/images";
import {
  baselineVersion,
  registerTrainedVersion,
  traditionalVersion,
  trainedVersion,
} from "../../testing/models";
import { ULTRALYTICS_RUNTIME } from "../../testing/workers";
import { database } from "./client";
import { refusingUnique } from "./errors";
import { inferenceOutcomes } from "./schema";

async function violatesUnique(
  error: unknown,
  constraint: string,
): Promise<boolean> {
  const refusal = new Error(constraint);
  try {
    await refusingUnique(
      constraint,
      () => refusal,
      () => Promise.reject(error),
    );
  } catch (caught) {
    return caught === refusal;
  }
  return false;
}

import {
  experimentCultureEvents,
  experiments,
  experimentTreatments,
  experimentUnits,
  modelVersions,
} from "./schema";

test("the database rejects a second terminal event", async () => {
  const suffix = randomUUID();
  const version = await baselineVersion();
  const experiment = await createExperiment({
    name: `Terminal invariant ${suffix}`,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    countsUnclear: false,
    treatments: [{ name: "Control", factor: null, note: "", replicates: 1 }],
  });
  const [unit] = await listUnits(experiment.id, await database());
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    modelId: version.modelId,
  });
  const day14 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    modelId: version.modelId,
  });
  await recordCultureEvents({
    experiment: experiment.id,
    units: [unit!.id],
    type: "discarded",
    observation: day7.id,
  });

  let rejection: unknown;
  try {
    await (
      await database()
    )
      .insert(experimentCultureEvents)
      .values({
        experimentId: experiment.id,
        id: randomUUID(),
        unitId: unit!.id,
        observationId: day14.id,
        type: "missing",
        /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
        recordedAt: new Date(),
      })
      .execute();
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(Error);
  const cause = (rejection as Error & { cause?: unknown }).cause;
  expect((cause as Error & { code?: string }).code).toBe("23505");
  expect((cause as Error).message).toContain(
    "experiment_culture_events_one_terminal",
  );
});

test("the database rejects a trained version without its provenance", async () => {
  const suffix = randomUUID();
  await traditionalVersion("provenance-detector", `baseline-${suffix}`);
  const valid = await registerTrainedVersion(
    "provenance-detector",
    `provenance-${suffix}`,
  );
  if (valid.source.kind !== "training_run") {
    throw new Error("expected a trained model version");
  }

  await expect(
    (await database())
      .insert(modelVersions)
      .values({
        id: `provenance-detector.orphan-${suffix}`,
        modelId: valid.modelId,
        createdAt: new Date(valid.createdAt),
        source: {
          ...valid.source,
          trainingRunId: `missing-${suffix}`,
        },
        artifact: valid.artifact,
      })
      .execute(),
  ).rejects.toThrow();
});

test("the database compares experiment, treatment and unit names without case", async () => {
  const suffix = randomUUID();
  const experiment = await createExperiment({
    name: `Case invariant ${suffix}`,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    countsUnclear: false,
    treatments: [{ name: "Control", factor: null, note: "", replicates: 1 }],
  });
  const db = await database();
  const [treatment] = await listTreatments(experiment.id, db);

  const rejection = async (write: () => Promise<unknown>): Promise<unknown> => {
    try {
      await write();
    } catch (error) {
      return error;
    }
    throw new Error("the database accepted the duplicate");
  };

  expect(
    await violatesUnique(
      await rejection(() =>
        db
          .insert(experiments)
          .values({
            id: randomUUID(),
            name: experiment.name.toUpperCase(),
            plantMaterial: "",
            explantType: "",
            baseMedium: "",
            notes: "",
            inoculatedOn: experiment.inoculatedOn,
            /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
            createdAt: new Date(),
          })
          .execute(),
      ),
      "experiments_name",
    ),
  ).toBeTrue();

  expect(
    await violatesUnique(
      await rejection(() =>
        db
          .insert(experimentTreatments)
          .values({
            experimentId: experiment.id,
            id: randomUUID(),
            name: "CONTROL",
            factor: null,
            note: "",
            position: 2,
          })
          .execute(),
      ),
      "experiment_treatments_name",
    ),
  ).toBeTrue();

  expect(
    await violatesUnique(
      await rejection(() =>
        db
          .insert(experimentUnits)
          .values({
            experimentId: experiment.id,
            id: randomUUID(),
            code: "control-1",
            treatmentId: treatment!.id,
          })
          .execute(),
      ),
      "experiment_units_code",
    ),
  ).toBeTrue();
});

test("the database refuses execution failures in the detection results", async () => {
  const version = await trainedVersion("exp-failure-fk");
  const [digest] = await storeTexts(["failure-fk"]);
  const failure = {
    schemaVersion: 1 as const,
    image: { digest },
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
    error: "no unit found",
  };

  const invalidFailure = (async () => {
    await (await database()).insert(inferenceOutcomes).values({
      imageId: digest!,
      modelVersionId: version.id,
      document: {
        ...failure,
        producer: failure.producer,
      } as never,
      /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
      recordedAt: new Date(),
    });
  })();
  await expect(invalidFailure).rejects.toThrow();
});
