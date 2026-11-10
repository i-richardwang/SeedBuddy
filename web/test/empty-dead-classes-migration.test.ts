import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import journal from "../drizzle/meta/_journal.json";
import { YOLO26N_WHOLE_RECIPE } from "../src/domain/training/recipes";

const MIGRATION = "0013_empty_dead_classes";
const TWO_STATES = ["ungerminated", "germinated"];
const FOUR_STATES = [...TWO_STATES, "empty", "dead"];

/** The instructions the seed model shipped with while it told two states apart. */
const SHIPPED_INSTRUCTIONS = `Box every visible seed separately, germinated or not. A seed is germinated
once a radicle or shoot has visibly broken through its coat, and ungerminated
until then; mark a box uncertain when its state cannot be told. Enclose the seed
body together with any radicle or shoot that emerged from it. Seeds include opaque
brown/gold and pale yellow/translucent bodies with a coherent elongated outline;
enclose the complete visible body, including pale coat and tips, before
minimizing background. Distinguish seeds and their radicles and shoots from
fibers and glare. Inspect touching clusters for separate bodies at different
angles; their rectangles may overlap naturally. Do not force an expected count
or mechanically shrink, expand or pad boxes.`;

const EXPERIMENT = "4f1d3c57-2d0e-4c4c-9d43-3b5bb35c1a01";
const TREATMENT = "8c2f6a64-51f0-4f0c-8a55-6f5a6f0b7a10";
const UNIT = "1d9b3a52-6f0e-4b1c-9b7e-2c4a8e6d5f33";
const DAYS = {
  sown: "0b8f2a9e-7a51-4c6e-8f0a-1f5d0d6f2b11",
  grown: "0b8f2a9e-7a51-4c6e-8f0a-1f5d0d6f2b12",
  shoots: "0b8f2a9e-7a51-4c6e-8f0a-1f5d0d6f2b13",
};

const trainedArtifact = {
  kind: "ultralytics",
  digest: "b".repeat(64),
  weights: { digest: "a".repeat(64), bytes: 100 },
  inference: {
    confidence: 0.3,
    imageSize: 1536,
    maxDetections: 500,
    endToEnd: false,
    mode: "whole_image",
  },
  training: YOLO26N_WHOLE_RECIPE,
  validation: {
    precision: 0.5,
    recall: 0.4,
    map50: 0.5,
    map50To95: 0.3,
    fitness: 0.3,
  },
};

const importedSource = {
  kind: "import",
  bundleDigest: "c".repeat(64),
  provenance: {
    dataset: { fingerprint: null, snapshotId: null, description: "Imported" },
    selectedEpoch: null,
    codeRevision: null,
    effectiveParameters: {},
    evaluation: { description: "None", calibration: "None", metrics: {} },
  },
};

/** A deployment as the release before left it, holding the seed model with `instructions`. */
async function deployed(
  instructions: string,
  /** What else the deployment held before the release reached it. */
  held: (db: PGlite) => Promise<unknown> = async () => {},
) {
  const db = new PGlite();
  const earlier = journal.entries
    .map((entry) => entry.tag)
    .filter((tag) => tag < MIGRATION);
  for (const tag of earlier)
    await db.exec(await Bun.file(`drizzle/${tag}.sql`).text());
  const model = async (id: string, classes: string[], text: string) =>
    db.query(
      "insert into models(id,name,task,classes,area,annotation) values($1,$1,'object_detection',$2,'dish',$3)",
      [
        id,
        JSON.stringify(classes),
        JSON.stringify({
          instructions: text,
          coreSize: 512,
          halo: 32,
          displayScale: 1,
        }),
      ],
    );
  const version = async (
    id: string,
    modelId: string,
    source: object,
    artifact: object,
  ) =>
    db.query(
      "insert into model_versions(id,model_id,created_at,source,artifact) values($1,$2,now(),$3,$4)",
      [id, modelId, JSON.stringify(source), JSON.stringify(artifact)],
    );
  const snapshot = async (id: string, dataset: string, modelId: string) => {
    await db.query(
      "insert into datasets(id,name,model_id,created_at) values($1,$2,$3,now())",
      [dataset, id, modelId],
    );
    await db.query(
      "insert into dataset_snapshots(id,dataset_id,model_id,area,created_at) values($1,$2,$3,'image',now())",
      [id, dataset, modelId],
    );
  };

  await model("seed-detector", TWO_STATES, instructions);
  await version(
    "traditional-v1",
    "seed-detector",
    { kind: "builtin", definition: "traditional-v1" },
    { kind: "traditional", digest: "d".repeat(64) },
  );
  await version(
    "seed-trained",
    "seed-detector",
    importedSource,
    trainedArtifact,
  );
  await snapshot(
    "snapshot-seed",
    "adbe448a-6d84-4558-976d-9b6cd657eeb3",
    "seed-detector",
  );
  await model("shoot-detector", ["shoot"], "Box every shoot.");
  await version("shoot-trained", "shoot-detector", importedSource, {
    ...trainedArtifact,
    digest: "e".repeat(64),
  });
  await snapshot(
    "snapshot-shoot",
    "5f0d8c0e-1a9b-4d5e-8a47-0d1f6a1f4c22",
    "shoot-detector",
  );

  // A germination trial: every seed counted the day it was sown, the
  // germinated ones a week later, with a dish counted by hand on each day.
  await db.query(
    "insert into experiments(id,name,plant_material,explant_type,base_medium,notes,inoculated_on,created_at) values($1,'Trial','','','','','2026-09-01',now())",
    [EXPERIMENT],
  );
  await db.query(
    "insert into experiment_treatments(experiment_id,id,name,note,position) values($1,$2,'A','',1)",
    [EXPERIMENT, TREATMENT],
  );
  await db.query(
    "insert into experiment_units(experiment_id,id,code,treatment_id) values($1,$2,'A-1',$3)",
    [EXPERIMENT, UNIT, TREATMENT],
  );
  const observation = async (
    id: string,
    day: string,
    modelId: string,
    counted: string[],
    tally: Record<string, number>,
  ) => {
    await db.query(
      "insert into experiment_observations(experiment_id,id,inoculated_on,observed_on,note,model_id,counted_classes,created_at) values($1,$2,'2026-09-01',$3,'',$4,$5,now())",
      [EXPERIMENT, id, day, modelId, JSON.stringify(counted)],
    );
    await db.query(
      "insert into experiment_manual_readings(experiment_id,unit_id,observation_id,tally,recorded_at) values($1,$2,$3,$4,now())",
      [EXPERIMENT, UNIT, id, JSON.stringify(tally)],
    );
  };
  await observation(DAYS.sown, "2026-09-01", "seed-detector", TWO_STATES, {
    ungerminated: 40,
    germinated: 5,
  });
  await observation(DAYS.grown, "2026-09-08", "seed-detector", ["germinated"], {
    germinated: 30,
  });
  await observation(DAYS.shoots, "2026-09-15", "shoot-detector", ["shoot"], {
    shoot: 12,
  });

  await held(db);
  await db.exec(await Bun.file(`drizzle/${MIGRATION}.sql`).text());
  return db;
}

async function classesOf(db: PGlite, table: string) {
  const { rows } = await db.query<{ id: string; classes: string[] }>(
    `select id, classes from ${table}`,
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.classes]));
}

async function instructionsOf(db: PGlite) {
  const { rows } = await db.query<{ instructions: string }>(
    "select annotation->>'instructions' as instructions from models where id='seed-detector'",
  );
  return rows[0]!.instructions;
}

test("the seed model declares two more states, and what was made before them keeps the classes it was made with", async () => {
  const db = await deployed(SHIPPED_INSTRUCTIONS);
  try {
    expect(await classesOf(db, "models")).toEqual({
      "seed-detector": FOUR_STATES,
      "shoot-detector": ["shoot"],
    });
    expect(await classesOf(db, "model_versions")).toEqual({
      "traditional-v1": ["ungerminated"],
      "seed-trained": TWO_STATES,
      "shoot-trained": ["shoot"],
    });
    expect(await classesOf(db, "dataset_snapshots")).toEqual({
      "snapshot-seed": TWO_STATES,
      "snapshot-shoot": ["shoot"],
    });
    await expect(
      db.query("update model_versions set classes=null"),
    ).rejects.toThrow();
    await expect(
      db.query("update dataset_snapshots set classes=null"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});

test("a day counts the seeds that hold an embryo from now on, and what was recorded keeps its meaning", async () => {
  const db = await deployed(SHIPPED_INSTRUCTIONS);
  try {
    const models = await db.query<{ id: string; counted_classes: string[] }>(
      "select id, counted_classes from models",
    );
    expect(
      Object.fromEntries(models.rows.map((m) => [m.id, m.counted_classes])),
    ).toEqual({
      "seed-detector": ["ungerminated", "germinated", "dead"],
      "shoot-detector": ["shoot"],
    });
    await expect(
      db.query("update models set counted_classes='[]'"),
    ).rejects.toThrow();

    const days = await db.query<{
      id: string;
      counted_classes: string[];
      tally: Record<string, number>;
    }>(
      "select o.id, o.counted_classes, r.tally from experiment_observations o join experiment_manual_readings r on r.observation_id = o.id",
    );
    const recorded = Object.fromEntries(
      days.rows.map((day) => [day.id, [day.counted_classes, day.tally]]),
    );
    // The day that counted every seed still does, and so does its count.
    expect(recorded[DAYS.sown]).toEqual([
      FOUR_STATES,
      { ungerminated: 40, germinated: 5, empty: 0, dead: 0 },
    ]);
    // A day that named what it counts, and a count that answered only that,
    // say nothing about the other states.
    expect(recorded[DAYS.grown]).toEqual([["germinated"], { germinated: 30 }]);
    expect(recorded[DAYS.shoots]).toEqual([["shoot"], { shoot: 12 }]);
  } finally {
    await db.close();
  }
});

test("the instructions the seed model shipped with come to describe four states", async () => {
  const db = await deployed(SHIPPED_INSTRUCTIONS);
  try {
    const instructions = await instructionsOf(db);
    expect(instructions).toContain("give each box one of\nfour states");
    expect(instructions).toContain("empty when its coat holds no embryo");
    expect(instructions).toContain("dead when its embryo has visibly died");
  } finally {
    await db.close();
  }
});

test("instructions a person rewrote stay as they wrote them", async () => {
  const rewritten = "Box the seeds the way this laboratory counts them.";
  const db = await deployed(rewritten);
  try {
    expect(await instructionsOf(db)).toBe(rewritten);
  } finally {
    await db.close();
  }
});

test("a model declares no more classes than there are colors to draw them in", async () => {
  const classes = (count: number) =>
    JSON.stringify(Array.from({ length: count }, (_, at) => `state_${at}`));
  const db = await deployed(SHIPPED_INSTRUCTIONS);
  try {
    await db.query("update models set classes=$1 where id='shoot-detector'", [
      classes(6),
    ]);
    for (const refused of [classes(7), "[]"]) {
      await expect(
        db.query("update models set classes=$1 where id='shoot-detector'", [
          refused,
        ]),
      ).rejects.toThrow(/models_classes_check/);
    }
  } finally {
    await db.close();
  }
  // A deployment that already holds such a model is not taken into the release.
  await expect(
    deployed(SHIPPED_INSTRUCTIONS, (db) =>
      db.query(
        "insert into models(id,name,task,classes,area,annotation) values('many-states','many-states','object_detection',$1,'image','{}')",
        [classes(7)],
      ),
    ),
  ).rejects.toThrow(/models_classes_check/);
});
