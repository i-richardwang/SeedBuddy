import { expect, spyOn, test } from "bun:test";

import { makeResult } from "../../../domain/annotation/testing";
import { inferenceAssignmentSchema } from "../../../domain/inference/assignments";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  DetectionOutcomeInvalidError,
  ProducerMismatchError,
} from "../../../domain/inference/errors";
import { MAX_MODEL_MANIFEST_BYTES } from "../../../domain/models/transfer";
import {
  TrainingArtifactInvalidError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../../domain/training/errors";
import {
  resolveTrainingRecipe,
  TRAINING_PRESETS,
} from "../../../domain/training/recipes";
import { trainingRunSchema } from "../../../domain/training/schema";
import { WorkerSessionConflictError } from "../../../domain/workers/errors";
import { Route as InferenceStoreRoute } from "../../../routes/api.images";
import {
  Route as InferenceHeartbeatRoute,
  Route as TrainingHeartbeatRoute,
} from "../../../routes/api.worker.heartbeat";
import { Route as InferenceClaimRoute } from "../../../routes/api.worker.inference.claim";
import { Route as InferenceLeaseRoute } from "../../../routes/api.worker.inference.claims.$versionId.$digest.lease";
import { Route as InferenceImageRoute } from "../../../routes/api.worker.inference.images.$digest";
import { Route as TrainingWeightsRoute } from "../../../routes/api.worker.inference.model-versions.$versionId.weights";
import { Route as InferenceResultRoute } from "../../../routes/api.worker.inference.results.$versionId.$digest";
import { Route as InferenceReadyRoute } from "../../../routes/api.worker.ready";
import { Route as TrainingClaimRoute } from "../../../routes/api.worker.training.claim";
import { Route as TrainingArtifactRoute } from "../../../routes/api.worker.training.runs.$runId.artifact";
import { Route as TrainingArtifactPartsRoute } from "../../../routes/api.worker.training.runs.$runId.artifact-parts";
import { Route as TrainingEpochsRoute } from "../../../routes/api.worker.training.runs.$runId.epochs";
import { Route as TrainingImageRoute } from "../../../routes/api.worker.training.runs.$runId.images.$digest";
import { Route as TrainingLeaseRoute } from "../../../routes/api.worker.training.runs.$runId.lease";
import { Route as TrainingPhaseRoute } from "../../../routes/api.worker.training.runs.$runId.phase";
import { Route as TrainingSnapshotRoute } from "../../../routes/api.worker.training.runs.$runId.snapshot";
import { createExperiment } from "../../experiments/design";
import { assignObservationImages } from "../../experiments/observation-images";
import { createObservation } from "../../experiments/observations";
import { listUnits } from "../../experiments/records";
import { completeInferenceClaim } from "../../inference/public";
import { listBlobs } from "../../infra/blobs/store";
import { database } from "../../infra/db/client";
import { contentDigest } from "../../infra/digest";
import { readReview } from "../../readings/public";
import { reviewedDataset } from "../../testing/datasets";
import { FIXTURE_EDGE, imageBytes, imageDigest } from "../../testing/images";
import { trainingBundle } from "../../testing/model-bundle";
import { baselineVersion } from "../../testing/models";
import { ULTRALYTICS_RUNTIME } from "../../testing/workers";
import {
  collectTrainingArtifactParts,
  readDatasetSnapshot,
} from "../../training/public";
import { createTrainingRun } from "../../training/runs";
import { enrollWorker } from "../../workers/public";
import { routeHandler, workerRoute } from "./testing";
import { WorkerRequestError, workerErrorResponse } from "./worker";

test("worker HTTP errors answer with the status the protocol acts on", () => {
  const status = (error: Error) =>
    workerErrorResponse(error, "Operation failed").status;
  expect(status(new WorkerRequestError("invalid request"))).toBe(400);
  expect(status(new DetectionOutcomeInvalidError("bad outcome"))).toBe(422);
  expect(status(new TrainingRunNotFoundError("unknown run"))).toBe(404);
  expect(status(new DetectionImageNotFoundError("unknown image"))).toBe(404);
  expect(status(new WorkerSessionConflictError("replaced"))).toBe(409);
  expect(status(new TrainingRunConflictError("lease missing"))).toBe(409);
  expect(
    status(new DetectionConflictError({ versionId: "v", digest: "d" })),
  ).toBe(409);
  expect(status(new ProducerMismatchError("other runtime"))).toBe(422);
  expect(status(new TrainingArtifactInvalidError("invalid"))).toBe(422);
});

test("worker HTTP errors hide unexpected server failures", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = workerErrorResponse(
      new Error("database connection string"),
      "Training operation failed",
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Training operation failed");
    expect(logged).toHaveBeenCalledTimes(1);
  } finally {
    logged.mockRestore();
  }
});

const digest = await imageDigest("image");

test("inference HTTP routes carry an image from upload to detection", async () => {
  const upload = await imageBytes("image");
  const stored = await routeHandler(
    InferenceStoreRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "content-length": String(upload.byteLength) },
      body: upload,
    }),
  } as never);
  expect(stored.status).toBe(200);
  expect(await stored.json()).toMatchObject({ digest });

  const version = await baselineVersion();
  const experiment = await createExperiment({
    name: "API",
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    countsUnclear: false,
    treatments: [{ name: "Test", factor: null, note: "", replicates: 1 }],
  });
  const [unit] = await listUnits(experiment.id, await database());
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    modelId: version.modelId,
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: [{ unit: unit!.id, digest, filename: "api.jpg" }],
  });
  const { token } = await enrollWorker("api-worker");
  const authorization = `Bearer ${token}`;
  const runtime = {
    adapter: "traditional" as const,
    fingerprint: "b".repeat(64),
  };
  const heartbeatResponse = await workerRoute(
    InferenceHeartbeatRoute,
    "POST",
  )({
    request: new Request("http://localhost/api/worker/heartbeat", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({
        sessionId: "api-session",
        startedAt: "2026-01-01T00:00:00Z",
        runtimes: [runtime],
        memoryBytes: 8 * 1024 ** 3,
      }),
    }),
  } as never);
  expect(heartbeatResponse.status).toBe(200);
  expect(await heartbeatResponse.json()).toMatchObject({
    workerId: "api-worker",
    sessionId: "api-session",
    runtimes: [runtime],
  });

  const claim = () =>
    workerRoute(
      InferenceClaimRoute,
      "POST",
    )({
      request: new Request("http://localhost/api/worker/inference/claim", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ sessionId: "api-session" }),
      }),
    } as never);
  let assignment: ReturnType<typeof inferenceAssignmentSchema.parse> | null =
    null;
  for (let attempt = 0; attempt < 500 && !assignment; attempt += 1) {
    const claimResponse = await claim();
    expect(claimResponse.status).toBe(200);
    const candidate = (await claimResponse.json()).assignment;
    if (!candidate) throw new Error("No inference work was claimed");
    const parsed = inferenceAssignmentSchema.parse(candidate);
    if (
      parsed.manifest.modelVersionId === version.id &&
      parsed.image === digest
    ) {
      assignment = parsed;
    } else {
      await completeInferenceClaim(
        { versionId: parsed.manifest.modelVersionId, digest: parsed.image },
        {
          schemaVersion: 1,
          image: {
            digest: parsed.image,
            width: FIXTURE_EDGE,
            height: FIXTURE_EDGE,
          },
          producer: {
            modelVersionId: parsed.manifest.modelVersionId,
            artifactDigest: parsed.manifest.artifact.digest,
            runtime,
          },
          instances: [],
          quality: { status: "ok", warnings: [] },
        },
        {
          workerId: "api-worker",
          sessionId: "api-session",
          attempt: parsed.attempt,
        },
      );
    }
  }
  if (!assignment) throw new Error("API test inference task was not claimed");
  expect(assignment.manifest).toEqual({
    schemaVersion: 1,
    modelVersionId: version.id,
    classes: ["ungerminated", "germinated"],
    artifact: version.artifact,
  });
  expect(assignment.image).toBe(digest);
  const renewed = await workerRoute(
    InferenceLeaseRoute,
    "POST",
  )({
    params: { versionId: version.id, digest },
    request: new Request(
      `http://localhost/api/worker/inference/claims/${version.id}/${digest}/lease`,
      {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({
          sessionId: "api-session",
          attempt: assignment.attempt,
        }),
      },
    ),
  } as never);
  expect(renewed.status).toBe(200);
  expect(
    new Date((await renewed.json()).leaseExpiresAt).getTime(),
  ).toBeGreaterThan(Date.now());
  expect(
    (
      await workerRoute(
        InferenceClaimRoute,
        "POST",
      )({
        request: new Request("http://localhost/api/worker/inference/claim", {
          method: "POST",
          headers: { authorization },
          body: JSON.stringify({}),
        }),
      } as never)
    ).status,
  ).toBe(400);

  const imageResponse = await workerRoute(
    InferenceImageRoute,
    "GET",
  )({
    params: { digest },
    request: new Request(
      `http://localhost/api/worker/inference/images/${digest}`,
      { headers: { authorization } },
    ),
  });
  expect(imageResponse.headers.get("Content-Type")).toBe("image/avif");
  expect(imageResponse.headers.get("Cache-Control")).toContain("immutable");
  expect(contentDigest(new Uint8Array(await imageResponse.arrayBuffer()))).toBe(
    digest,
  );

  const result = {
    ...makeResult([{ id: 0, x: 5, y: 5 }], {
      digest,
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
  const target = { versionId: version.id, digest };
  const put = (body: unknown, sessionId = "api-session") =>
    workerRoute(
      InferenceResultRoute,
      "PUT",
    )({
      params: target,
      request: new Request(
        `http://localhost/api/worker/inference/results/${version.id}/${digest}?sessionId=${sessionId}&attempt=${assignment!.attempt}`,
        {
          method: "PUT",
          headers: { authorization },
          body: JSON.stringify(body),
        },
      ),
    } as never);
  const rawPut = (params: typeof target, body: string) =>
    workerRoute(
      InferenceResultRoute,
      "PUT",
    )({
      params,
      request: new Request(
        `http://localhost/api/worker/inference/results/${params.versionId}/${params.digest}?sessionId=api-session&attempt=${assignment!.attempt}`,
        { method: "PUT", headers: { authorization }, body },
      ),
    } as never);
  expect((await rawPut(target, "not json")).status).toBe(400);
  expect(
    (
      await rawPut(
        { versionId: "not a version", digest },
        JSON.stringify(result),
      )
    ).status,
  ).toBe(400);
  expect((await put(result, "replaced-session")).status).toBe(409);
  expect(
    (
      await put({
        ...result,
        image: { ...result.image, digest: "0".repeat(64) },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await put({
        ...result,
        producer: { ...result.producer, artifactDigest: "d".repeat(64) },
      })
    ).status,
  ).toBe(422);
  expect((await put(result)).status).toBe(200);
  expect(
    (
      await readReview(
        { digest, modelId: version.modelId },
        "api.jpg",
        await database(),
      )
    )?.detection,
  ).toEqual(result);
  expect((await put(result)).status).toBe(200);
  expect(
    (
      await put({
        ...result,
        quality: { status: "review_required", warnings: [] },
      })
    ).status,
  ).toBe(409);
});

test("readiness names the enrolled worker a token belongs to", async () => {
  const { token } = await enrollWorker("ready-worker");
  const ready = (authorization: string) =>
    workerRoute(
      InferenceReadyRoute,
      "GET",
    )({
      request: new Request("http://localhost/api/worker/ready", {
        headers: { authorization },
      }),
    } as never);
  const response = await ready(`Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ workerId: "ready-worker" });
  expect((await ready("Bearer vfw_unknown")).status).toBe(401);
});

test("storing an image rejects an absent or excessive body before reading it", async () => {
  const post = (request: Request) =>
    routeHandler(InferenceStoreRoute, "POST")({ request } as never);

  const absent = await post(
    new Request("http://localhost/api/images", { method: "POST" }),
  );
  expect(absent.status).toBe(411);

  const excessive = await post(
    new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "content-length": String(64 * 1024 * 1024 + 1) },
      body: new Uint8Array([1]),
    }),
  );
  expect(excessive.status).toBe(413);
});

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
      TrainingHeartbeatRoute,
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
      TrainingClaimRoute,
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
      TrainingSnapshotRoute,
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
      TrainingImageRoute,
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
      TrainingPhaseRoute,
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
      TrainingEpochsRoute,
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
      TrainingLeaseRoute,
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
      TrainingPhaseRoute,
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
      TrainingArtifactPartsRoute,
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
      TrainingArtifactRoute,
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
      TrainingArtifactRoute,
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
      TrainingWeightsRoute,
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
    TrainingPhaseRoute,
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
    TrainingLeaseRoute,
    "POST",
  )({
    params: { runId: "train-missing" },
    request: new Request("http://localhost/lease", {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ sessionId: "trainer-session", attempt: 1 }),
    }),
  } as never);
  expect(conflict.status).toBe(404);
});

test("training artifact admission rejects unknown and excessive request sizes", async () => {
  const { token } = await enrollWorker("api-boundary-trainer");
  const authorization = `Bearer ${token}`;
  const put = (request: Request) =>
    workerRoute(
      TrainingArtifactRoute,
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
