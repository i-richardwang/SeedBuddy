import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { SEED_DETECTOR } from "../src/domain/models/builtins";
import { YOLO26N_WHOLE_RECIPE } from "../src/domain/training/recipes";

test("local training migration binds recovery to its owner and pauses active executions", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "0000_init.sql",
      "0001_training_control.sql",
      "0002_model_registry.sql",
      "0003_inference_execution.sql",
      "0004_observation_counted_classes.sql",
      "0005_unclear_images.sql",
      "0006_experiment_unclear_policy.sql",
    ])
      await db.exec(await Bun.file(`drizzle/${file}`).text());
    const model = SEED_DETECTOR;
    const dataset = "adbe448a-6d84-4558-976d-9b6cd657eeb3";
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
      "insert into training_runs(id,model_id,dataset_snapshot_id,created_at,attempt,recipe,status,worker_id,session_id,lease_expires_at,phase,progress,checkpoint) values('train-existing',$1,'snapshot-existing',now(),1,$2,'running','gpu-1','session-1',now()+interval '5 minutes','training',0.2,$3)",
      [
        model.id,
        JSON.stringify(YOLO26N_WHOLE_RECIPE),
        JSON.stringify({
          attempt: 1,
          epoch: 3,
          digest: "a".repeat(64),
          bytes: 1024,
        }),
      ],
    );
    await db.query(
      "insert into training_attempts(run_id,attempt,worker_id,started_at) values('train-existing',1,'gpu-1',now())",
    );
    await db.exec(await Bun.file("drizzle/0007_local_training.sql").text());
    expect(
      (
        await db.query(
          "select status,target_worker_id,worker_id,session_id,checkpoint,recipe from training_runs",
        )
      ).rows,
    ).toEqual([
      {
        status: "paused",
        target_worker_id: "gpu-1",
        worker_id: null,
        session_id: null,
        checkpoint: { attempt: 1, epoch: 3, workerId: "gpu-1" },
        recipe: YOLO26N_WHOLE_RECIPE,
      },
    ]);
    expect(
      (
        await db.query(
          "select outcome,finished_at is not null as finished from training_attempts",
        )
      ).rows,
    ).toEqual([{ outcome: "paused", finished: true }]);
  } finally {
    await db.close();
  }
});
