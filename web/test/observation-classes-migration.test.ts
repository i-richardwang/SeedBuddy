import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { SEED_DETECTOR } from "../src/domain/models/builtins";

test("an observation recorded before days named their classes counts every class its model recognizes", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "0000_init.sql",
      "0001_training_control.sql",
      "0002_model_registry.sql",
      "0003_inference_execution.sql",
    ])
      await db.exec(await Bun.file(`drizzle/${file}`).text());
    const model = SEED_DETECTOR;
    const experiment = "4f1d3c57-2d0e-4c4c-9d43-3b5bb35c1a01";
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
      "insert into experiments(id,name,plant_material,explant_type,base_medium,notes,inoculated_on,created_at) values($1,'Existing','','','','','2026-09-01',now())",
      [experiment],
    );
    await db.query(
      "insert into experiment_observations(experiment_id,id,inoculated_on,observed_on,note,model_id,created_at) values($1,'0b8f2a9e-7a51-4c6e-8f0a-1f5d0d6f2b11','2026-09-01','2026-09-01','',$2,now())",
      [experiment, model.id],
    );

    await db.exec(
      await Bun.file("drizzle/0004_observation_counted_classes.sql").text(),
    );
    const observations = await db.query<{ counted_classes: string[] }>(
      "select counted_classes from experiment_observations",
    );
    expect(observations.rows).toEqual([{ counted_classes: model.classes }]);
    await expect(
      db.query("update experiment_observations set counted_classes='[]'"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
