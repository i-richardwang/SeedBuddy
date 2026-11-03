import { expect, test } from "bun:test";

import { makeResult } from "../../../domain/annotation/testing";
import { inferenceAssignmentSchema } from "../../../domain/inference/assignments";
import { Route as StoreRoute } from "../../../routes/api.images";
import { Route as HeartbeatRoute } from "../../../routes/api.worker.heartbeat";
import { Route as ClaimRoute } from "../../../routes/api.worker.inference.claim";
import { Route as LeaseRoute } from "../../../routes/api.worker.inference.claims.$versionId.$digest.lease";
import { Route as ImageRoute } from "../../../routes/api.worker.inference.images.$digest";
import { Route as ResultRoute } from "../../../routes/api.worker.inference.results.$versionId.$digest";
import { Route as ReadyRoute } from "../../../routes/api.worker.ready";
import { createExperiment } from "../../experiments/design";
import { assignObservationImages } from "../../experiments/observation-images";
import { addObservation } from "../../experiments/observations";
import { listUnits } from "../../experiments/records";
import { completeInferenceClaim } from "../../inference/public";
import { database } from "../../infra/db/client";
import { contentDigest } from "../../infra/digest";
import { readReview } from "../../readings/public";
import {
  baselineVersion,
  FIXTURE_EDGE,
  imageBytes,
  imageDigest,
} from "../../testing/fixtures";
import { enrollWorker } from "../../workers/public";
import { routeHandler, workerRoute } from "./testing";

const digest = await imageDigest("image");

test("inference HTTP routes carry an image from upload to detection", async () => {
  const upload = await imageBytes("image");
  const stored = await routeHandler(
    StoreRoute,
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
  const observation = await addObservation({
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
    HeartbeatRoute,
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
      ClaimRoute,
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
    LeaseRoute,
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
        ClaimRoute,
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
    ImageRoute,
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
      ResultRoute,
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
      ResultRoute,
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
  ).toBe(400);
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
      ReadyRoute,
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
    routeHandler(StoreRoute, "POST")({ request } as never);

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
