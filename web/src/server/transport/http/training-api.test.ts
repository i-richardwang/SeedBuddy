import { trainingBundle } from "../../testing/model-bundle";
import { collectTrainingArtifactParts } from "../../training/public";
import { listBlobs } from "../../infra/blobs/store";
import { readDatasetSnapshot } from "../../training/public";
import { expect, test } from "bun:test";

import {
  TRAINING_PRESETS,
  resolveTrainingRecipe,
} from "../../../domain/training/recipes";
import { MAX_MODEL_MANIFEST_BYTES } from "../../../domain/models/transfer";
import { trainingRunSchema } from "../../../domain/training/schema";
import { Route as HeartbeatRoute } from "../../../routes/api.worker.heartbeat";
import { Route as WeightsRoute } from "../../../routes/api.worker.inference.model-versions.$versionId.weights";
import { Route as ClaimRoute } from "../../../routes/api.worker.training.claim";
import { Route as ArtifactRoute } from "../../../routes/api.worker.training.runs.$runId.artifact";
import { Route as EpochsRoute } from "../../../routes/api.worker.training.runs.$runId.epochs";
import { Route as ArtifactPartsRoute } from "../../../routes/api.worker.training.runs.$runId.artifact-parts";
import { Route as ImageRoute } from "../../../routes/api.worker.training.runs.$runId.images.$digest";
import { Route as LeaseRoute } from "../../../routes/api.worker.training.runs.$runId.lease";
import { Route as PhaseRoute } from "../../../routes/api.worker.training.runs.$runId.phase";
import { Route as SnapshotRoute } from "../../../routes/api.worker.training.runs.$runId.snapshot";
import { contentDigest } from "../../infra/digest";
import { ULTRALYTICS_RUNTIME, reviewedDataset } from "../../testing/fixtures";
import { createTrainingRun } from "../../training/runs";
import { enrollWorker } from "../../workers/public";
import { workerRoute } from "./testing";

const SESSION = { sessionId: "api-trainer-session" };

test("the shared training claim fixture is the Web training contract", async () => {
  const fixture = await Bun.file(
    new URL(
      "../../../../../tests/fixtures/contracts/training-claim.json",
      import.meta.url,
    ),
  ).json();
  expect(trainingRunSchema.parse(fixture.run)).toEqual(fixture.run);
});

test.each([...TRAINING_PRESETS])(
  "training HTTP routes publish $id and serve its weights idempotently",
  async (preset) => {
    const recipe = resolveTrainingRecipe(preset.id, {});
    const { version: sourceVersion, dataset } = await reviewedDataset(
      `training-api-${preset.id}`,
      ["first", "second"],
    );

    const created = await createTrainingRun(dataset.id, recipe);
    const { token } = await enrollWorker(`api-trainer-${preset.id}`);
    const authorization = `Bearer ${token}`;

    const heartbeat = await workerRoute(
      HeartbeatRoute,
      "POST",
    )({
      request: new Request("http://localhost/api/worker/heartbeat", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({
          ...SESSION,
          startedAt: "2026-08-27T00:00:00.000Z",
          runtimes: [ULTRALYTICS_RUNTIME],
          memoryBytes: 24 * 1024 ** 3,
        }),
      }),
    } as never);
    expect(heartbeat.status).toBe(200);

    const claim = await workerRoute(
      ClaimRoute,
      "POST",
    )({
      request: new Request("http://localhost/api/worker/training/claim", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify(SESSION),
      }),
    } as never);
    const job = await claim.json();
    expect(job.run.id).toBe(created.id);
    expect(job.run.recipe).toEqual(recipe);
    expect(Object.keys(job)).toEqual(["run"]);

    const snapshot = await workerRoute(
      SnapshotRoute,
      "GET",
    )({
      params: { runId: created.id },
      request: new Request(
        `http://localhost/api/worker/training/runs/${created.id}/snapshot?${new URLSearchParams({ ...SESSION, attempt: "1" })}`,
        { headers: { authorization } },
      ),
    } as never);
    const snapshotImages = (await snapshot.json()).images;
    expect(snapshotImages).toHaveLength(2);
    const digest = snapshotImages[0].digest;

    const image = await workerRoute(
      ImageRoute,
      "GET",
    )({
      params: { runId: created.id, digest },
      request: new Request(
        `http://localhost/api/worker/training/runs/${created.id}/images/${digest}?${new URLSearchParams({ ...SESSION, attempt: "1" })}`,
        { headers: { authorization } },
      ),
    } as never);
    expect(image.status).toBe(200);
    expect(contentDigest(new Uint8Array(await image.arrayBuffer()))).toBe(
      digest,
    );

    const trainingPhase = await workerRoute(
      PhaseRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request("http://localhost/phase", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ ...SESSION, attempt: 1, phase: "training" }),
      }),
    } as never);
    expect(trainingPhase.status).toBe(200);

    const epoch = await workerRoute(
      EpochsRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request("http://localhost/epochs", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({
          ...SESSION,
          attempt: 1,
          epoch: 1,
          train: { box: 1.2, classification: 2.4, regression: 1.1 },
          val: { box: 1.3, classification: 2.5, regression: 1.2 },
          precision: 0.5,
          recall: 0.4,
          map50: 0.45,
          map50To95: 0.2,
          fitness: 0.225,
          learningRate: 0.001,
        }),
      }),
    } as never);
    expect(epoch.status).toBe(200);
    const reported = (await epoch.json()).state;
    expect(reported.phase).toBe("training");
    expect(reported.progress).toBeCloseTo(
      0.05 + 0.85 / recipe.parameters.epochs,
    );

    const lease = await workerRoute(
      LeaseRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request("http://localhost/lease", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ ...SESSION, attempt: 1 }),
      }),
    } as never);
    expect(lease.status).toBe(200);
    expect((await lease.json()).state.progress).toBeCloseTo(reported.progress);

    const validationPhase = await workerRoute(
      PhaseRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request("http://localhost/phase", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ ...SESSION, attempt: 1, phase: "validating" }),
      }),
    } as never);
    expect(validationPhase.status).toBe(200);
    expect((await validationPhase.json()).state.progress).toBe(0.9);

    const publication = {
      schemaVersion: 1,
      weights: "weights/best.pt",
      inference: {
        ready: true,
        confidence: 0.42,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.5,
        recall: 0.4,
        map50: 0.45,
        map50To95: 0.2,
        fitness: 0.225,
      },
      training: {
        baseModel: recipe.baseModel,
        parameters: recipe.parameters,
        runtime: recipe.runtime,
      },
    };
    const frozen = await readDatasetSnapshot(created.datasetSnapshotId);
    const bundle = trainingBundle(
      new TextEncoder().encode("weights"),
      publication,
      frozen!.classes,
      frozen!.id,
    );
    const artifactQuery = new URLSearchParams({ ...SESSION, attempt: "1" });
    const partQuery = new URLSearchParams({
      ...SESSION,
      attempt: "1",
      bytes: String(bundle.weights.bytes),
      digest: bundle.weights.digest,
      part: "0",
    });
    const weightsPart = await workerRoute(
      ArtifactPartsRoute,
      "PUT",
    )({
      params: { runId: created.id },
      request: new Request(`http://localhost/artifact-parts?${partQuery}`, {
        method: "PUT",
        headers: {
          authorization,
          "content-length": String(bundle.weights.bytes),
          "x-artifact-part-sha256": bundle.weights.digest,
        },
        body: "weights",
      }),
    });
    expect(weightsPart.status).toBe(204);
    const artifact = await workerRoute(
      ArtifactRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request(`http://localhost/artifact?${artifactQuery}`, {
        method: "POST",
        headers: { authorization, "content-length": "1000" },
        body: JSON.stringify(bundle),
      }),
    } as never);
    expect(artifact.status).toBe(200);
    const published = await artifact.json();
    expect(published.state.status).toBe("succeeded");

    await collectTrainingArtifactParts();
    expect(
      await listBlobs(`training-artifact-parts/${created.id}/`),
    ).toHaveLength(0);
    const repeated = await workerRoute(
      ArtifactRoute,
      "POST",
    )({
      params: { runId: created.id },
      request: new Request(`http://localhost/artifact?${artifactQuery}`, {
        method: "POST",
        headers: { authorization, "content-length": "1000" },
        body: JSON.stringify(bundle),
      }),
    } as never);
    expect(await repeated.json()).toEqual(published);
    expect(published.modelId).toBe(sourceVersion.modelId);

    const versionId = published.state.modelVersionId;
    const weights = await workerRoute(
      WeightsRoute,
      "GET",
    )({
      params: { versionId },
      request: new Request("http://localhost/weights", {
        headers: { authorization },
      }),
    });
    expect(await weights.text()).toBe("weights");
  },
);

test("training HTTP routes distinguish invalid requests from lease conflicts", async () => {
  const { token } = await enrollWorker("api-conflict-trainer");
  const authorization = `Bearer ${token}`;
  const invalid = await workerRoute(
    PhaseRoute,
    "POST",
  )({
    params: { runId: "train-invalid" },
    request: new Request("http://localhost/phase", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({
        sessionId: "trainer-session",
        phase: "complete",
      }),
    }),
  } as never);
  expect(invalid.status).toBe(400);

  const conflict = await workerRoute(
    LeaseRoute,
    "POST",
  )({
    params: { runId: "train-missing" },
    request: new Request("http://localhost/lease", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ sessionId: "trainer-session", attempt: 1 }),
    }),
  } as never);
  expect(conflict.status).toBe(409);
});

test("training artifact admission rejects unknown and excessive request sizes", async () => {
  const { token } = await enrollWorker("api-boundary-trainer");
  const authorization = `Bearer ${token}`;
  const put = (request: Request) =>
    workerRoute(
      ArtifactRoute,
      "POST",
    )({ params: { runId: "train-boundary" }, request } as never);

  const unknown = await put(
    new Request("http://localhost/artifact", {
      method: "POST",
      headers: { authorization },
    }),
  );
  expect(unknown.status).toBe(411);

  const excessive = await put(
    new Request("http://localhost/artifact", {
      method: "POST",
      headers: {
        authorization,
        "content-length": String(MAX_MODEL_MANIFEST_BYTES + 1),
      },
      body: new Uint8Array([1]),
    }),
  );
  expect(excessive.status).toBe(413);
});
