import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { recordCultureEvent } from "../../experiments/culture-events";
import { createExperiment } from "../../experiments/design";
import { createObservation } from "../../experiments/observations";
import { listTreatments, listUnits } from "../../experiments/records";
import {
  baselineVersion,
  registerTrainedVersion,
  traditionalVersion,
} from "../../testing/fixtures";
import { database } from "./client";
import { isUniqueViolation } from "./errors";
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
  await recordCultureEvent({
    experiment: experiment.id,
    unit: unit!.id,
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
    isUniqueViolation(
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
            createdAt: new Date(),
          })
          .execute(),
      ),
      "experiments_name",
    ),
  ).toBeTrue();

  expect(
    isUniqueViolation(
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
    isUniqueViolation(
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
