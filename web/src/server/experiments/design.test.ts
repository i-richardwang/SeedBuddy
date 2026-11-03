import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import {
  ExperimentNameTakenError,
  ExperimentNotFoundError,
  ExperimentRecordsConflictError,
  ObservationConflictError,
  TreatmentConflictError,
  TreatmentNotFoundError,
  UnitConflictError,
  UnitNameTakenError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import {
  calendarDaySchema,
  formatFactor,
} from "../../domain/experiments/schema";
import {
  SEED_DETECTOR_BASELINE_VERSION_ID,
  SEED_DETECTOR_MODEL_ID,
} from "../../domain/models/builtins";
import { imageBlobKey } from "../images/keys";
import { blobExists } from "../infra/blobs/store";
import { database } from "../infra/db/client";
import { experimentUnits } from "../infra/db/schema";
import { listAllModelVersions } from "../models/registry";
import {
  assignImages,
  createExperiment,
  INOCULATED,
  reading,
  trainedVersion,
  unitsOf,
} from "../testing/experiments";
import { imageDigest } from "../testing/images";
import {
  addReplicates,
  addTreatment,
  deleteExperiment,
  deleteTreatment,
  deleteUnit,
  moveUnits,
  updateExperiment,
  updateTreatment,
  updateUnit,
} from "./design";
import { createObservation } from "./observations";
import { experimentGridDetail, listExperimentOverviews } from "./queries";

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
  const observation = await createObservation({
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
  ).rejects.toThrow(ExperimentNameTakenError);

  expect(first.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(first.name).toBe("Germination A");

  const invalidUnit = (async () => {
    const [treatment] = (await experimentGridDetail(first.id))!.treatments;
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

  const grid = (await experimentGridDetail(experiment.id))!;
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

  const summary = (await listExperimentOverviews()).find(
    ({ experiment: item }) => item.id === experiment.id,
  );
  expect(summary?.treatments).toBe(2);
  expect(summary?.units).toBe(5);
  expect(summary?.observations).toBe(0);
  expect(summary?.lastObservedOn).toBeNull();
});

test("a treatment can gain replicates after it is designed", async () => {
  const experiment = await createExperiment({
    name: "More units",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "T1", replicates: 1 }],
  });
  const [treatment] = (await experimentGridDetail(experiment.id))!.treatments;
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
  const grid = await experimentGridDetail(experiment.id);
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
  const [control, treated] = (await experimentGridDetail(experiment.id))!
    .treatments;

  await expect(
    addTreatment({
      experiment: experiment.id,
      name: "ck",
      factor: null,
      note: "",
      replicates: 1,
    }),
  ).rejects.toMatchObject({
    code: "treatment_name_taken",
    category: "conflict",
  });
  await expect(
    updateTreatment({
      experiment: experiment.id,
      treatment: treated!.id,
      name: "CK",
      factor: null,
      note: "",
    }),
  ).rejects.toMatchObject({
    code: "treatment_name_taken",
    category: "conflict",
  });

  const units = await unitsOf(experiment.id);
  await expect(
    updateUnit({
      experiment: experiment.id,
      unit: units.get("T1-1")!,
      code: "ck-1",
      treatment: treated!.id,
    }),
  ).rejects.toThrow(UnitNameTakenError);
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
  const after = await experimentGridDetail(experiment.id);
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
  const [control, treated] = (await experimentGridDetail(experiment.id))!
    .treatments;
  const units = await unitsOf(experiment.id);

  await expect(
    deleteUnit({ experiment: experiment.id, unit: units.get("CK-1")! }),
  ).rejects.toThrow(UnitConflictError);
  await expect(
    updateUnit({
      experiment: experiment.id,
      unit: units.get("CK-1")!,
      code: "CK-1",
      treatment: treated!.id,
    }),
  ).rejects.toThrow(UnitConflictError);
  await deleteUnit({ experiment: experiment.id, unit: units.get("T1-2")! });

  await deleteTreatment({
    experiment: experiment.id,
    treatment: control!.id,
  });
  await expect(
    deleteTreatment({ experiment: experiment.id, treatment: treated!.id }),
  ).rejects.toThrow(TreatmentConflictError);
  expect(
    (await experimentGridDetail(experiment.id))?.units.map((unit) => unit.code),
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
  const [control, treated] = (await experimentGridDetail(experiment.id))!
    .treatments;
  const units = await unitsOf(experiment.id);

  await expect(
    moveUnits({
      experiment: experiment.id,
      units: [units.get("CK-1")!, units.get("CK-2")!, units.get("CK-3")!],
      treatment: treated!.id,
    }),
  ).rejects.toThrow(UnitConflictError);
  expect(
    (await experimentGridDetail(experiment.id))?.units.filter(
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
    (await experimentGridDetail(experiment.id))?.units.filter(
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
  const [control, treated] = (await experimentGridDetail(experiment.id))!
    .treatments;
  const observation = await createObservation({
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
  ).rejects.toThrow(TreatmentConflictError);
  await deleteTreatment({
    experiment: experiment.id,
    treatment: control!.id,
  });
  const grid = await experimentGridDetail(experiment.id);
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
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  await assignImages(experiment.id, observation.id, units, {
    "A-1": "r-a1",
  });

  const [treatment] = (await experimentGridDetail(experiment.id))!.treatments;
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
  ).rejects.toThrow(UnitNameTakenError);

  const grid = await experimentGridDetail(experiment.id);
  expect(grid?.units.map((unit) => unit.code)).toEqual(["A-01", "A-2"]);
  expect(grid?.images).toHaveLength(1);
  expect(grid?.images[0]?.unit).toBe(units.get("A-1")!);
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
  await createObservation({
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
  ).rejects.toThrow(ObservationConflictError);

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

  const treatment = (await experimentGridDetail(experiment.id))!.treatments[0]!;
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
    (await experimentGridDetail(experiment.id))?.units.map((unit) => unit.code),
  ).toEqual(["A-2", "T1-1"]);
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
  expect([revised.name, revised.inoculatedOn]).toEqual(["Final", "2026-08-02"]);

  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  await assignImages(experiment.id, day7.id, units, {
    "A-1": "m-a1-1",
    "A-2": "m-a2-1",
  });
  await expect(
    deleteUnit({
      experiment: experiment.id,
      unit: units.get("A-2")!,
    }),
  ).rejects.toThrow(UnitConflictError);
  const grid = await experimentGridDetail(experiment.id);
  expect(grid?.observations.map((item) => item.id)).toEqual([day7.id]);
  expect(grid?.units.map((unit) => unit.code)).toEqual(["A-1", "A-2"]);
  expect(grid?.images).toHaveLength(2);
  const first = await imageDigest("m-a1-1");
  expect(await blobExists(imageBlobKey(first))).toBeTrue();

  await expect(deleteExperiment({ experiment: experiment.id })).rejects.toThrow(
    ExperimentRecordsConflictError,
  );

  const disposable = await createExperiment({
    name: "Disposable draft",
    inoculatedOn: INOCULATED,
  });
  await deleteExperiment({ experiment: disposable.id });
  expect(await experimentGridDetail(disposable.id)).toBeNull();
  await expect(deleteExperiment({ experiment: disposable.id })).rejects.toThrow(
    ExperimentNotFoundError,
  );
  expect(await blobExists(imageBlobKey(first))).toBeTrue();
});
