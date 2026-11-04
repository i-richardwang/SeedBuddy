import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { SEED_DETECTOR } from "../src/domain/models/builtins";
import { YOLO26N_WHOLE_RECIPE } from "../src/domain/training/recipes";

test("registry migration preserves existing weights, version identity and current selection", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0000_init.sql", "0001_training_control.sql"])
      await db.exec(await Bun.file(`drizzle/${file}`).text());
    const model = SEED_DETECTOR;
    const dataset = "adbe448a-6d84-4558-976d-9b6cd657eeb3";
    const digest = "a".repeat(64);
    const source = {
      kind: "training_run",
      trainingRunId: "train-existing",
      trainingAttempt: 1,
      datasetSnapshotId: "snapshot-existing",
    };
    const artifact = {
      kind: "ultralytics",
      digest: "b".repeat(64),
      weights: { digest, bytes: 100 },
      inference: {
        confidence: 0.3,
        imageSize: 1536,
        maxDetections: 500,
        endToEnd: false,
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
    await db.query(
      "insert into models(id,name,task,classes,annotation) values($1,$2,$3,$4,$5)",
      [
        model.id,
        model.name,
        model.task,
        JSON.stringify(model.classes),
        JSON.stringify(model.annotation),
      ],
    );
    await db.query(
      "insert into datasets(id,name,model_id,created_at) values($1,'existing',$2,now())",
      [dataset, model.id],
    );
    await db.query(
      "insert into dataset_snapshots(id,dataset_id,model_id,created_at) values('snapshot-existing',$1,$2,now())",
      [dataset, model.id],
    );
    await db.query(
      "insert into training_runs(id,model_id,dataset_snapshot_id,created_at,attempt,recipe,status) values('train-existing',$1,'snapshot-existing',now(),1,$2,'queued')",
      [model.id, JSON.stringify(YOLO26N_WHOLE_RECIPE)],
    );
    await db.query(
      "insert into model_versions(id,model_id,created_at,source,artifact) values('train-existing',$1,now(),$2,$3)",
      [model.id, JSON.stringify(source), JSON.stringify(artifact)],
    );
    await db.exec(
      "update training_runs set status='succeeded',model_version_id='train-existing'; update models set current_version_id='train-existing';",
    );
    await db.exec(await Bun.file("drizzle/0002_model_registry.sql").text());
    const versions = await db.query<{
      id: string;
      source: unknown;
      artifact: unknown;
      weights_key: string;
    }>("select id,source,artifact,weights_key from model_versions");
    expect(versions.rows).toEqual([
      {
        id: "train-existing",
        source,
        artifact,
        weights_key: `model-weights/train-existing/1/${digest}`,
      },
    ]);
    const selected = await db.query<{ current_version_id: string }>(
      "select current_version_id from models",
    );
    expect(selected.rows[0]!.current_version_id).toBe("train-existing");
  } finally {
    await db.close();
  }
});
