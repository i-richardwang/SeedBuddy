import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  SEED_DETECTOR,
  SEED_DETECTOR_BASELINE,
} from "../src/domain/models/builtins";

test("inference migration preserves successful results and terminal errors and requeues unfinished work", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "0000_init.sql",
      "0001_training_control.sql",
      "0002_model_registry.sql",
    ])
      await db.exec(await Bun.file(`drizzle/${file}`).text());
    const model = SEED_DETECTOR,
      version = SEED_DETECTOR_BASELINE;
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
      "insert into model_versions(id,model_id,created_at,source,artifact) values($1,$2,now(),$3,$4)",
      [
        version.id,
        model.id,
        JSON.stringify(version.source),
        JSON.stringify(version.artifact),
      ],
    );
    const digests = ["a", "b", "c"].map((x) => x.repeat(64));
    for (const digest of digests)
      await db.query(
        "insert into images(id,bytes,width,height,received_at) values($1,100,10,10,now())",
        [digest],
      );
    const producer = {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: { adapter: "traditional", fingerprint: "e".repeat(64) },
    };
    const result = {
      schemaVersion: 1,
      image: { digest: digests[0], width: 10, height: 10 },
      producer,
      instances: [],
      quality: { status: "ok", warnings: [] },
    };
    const failure = {
      schemaVersion: 1,
      image: { digest: digests[1] },
      producer,
      error: "Old execution failed",
    };
    for (const document of [result, failure])
      await db.query(
        "insert into inference_outcomes(image_id,model_version_id,document,recorded_at) values($1,$2,$3,now())",
        [document.image.digest!, version.id, JSON.stringify(document)],
      );
    await db.exec(
      "insert into workers(id,token_hash,enrolled_at) values('old-worker','hash',now())",
    );
    await db.query(
      "insert into inference_jobs(image_id,model_version_id,worker_id,session_id,attempt,lease_expires_at) values($1,$2,'old-worker','old-session',7,now()+interval '5 minutes')",
      [digests[2], version.id],
    );
    await db.exec(
      await Bun.file("drizzle/0003_inference_execution.sql").text(),
    );
    expect(
      (
        await db.query(
          "select status,error,attempt from inference_tasks order by image_id",
        )
      ).rows,
    ).toEqual([
      { status: "succeeded", error: null, attempt: 0 },
      { status: "failed", error: "Old execution failed", attempt: 0 },
      { status: "queued", error: null, attempt: 7 },
    ]);
    expect(
      (await db.query("select document from inference_outcomes")).rows,
    ).toEqual([{ document: result }]);
    expect((await db.query("select * from inference_attempts")).rows).toEqual(
      [],
    );
    expect(
      (await db.query("select to_regclass('inference_jobs') as old_table"))
        .rows,
    ).toEqual([{ old_table: null }]);
    await expect(
      db.query(
        "insert into inference_outcomes(image_id,model_version_id,document,recorded_at) values($1,$2,$3,now())",
        [digests[1], version.id, JSON.stringify(failure)],
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
