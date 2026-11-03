import { expect, test } from "bun:test";

import { TRAINING_ARTIFACT_PART_BYTES } from "../../domain/training/artifact";
import { TrainingRunConflictError } from "../../domain/training/errors";
import { YOLO26N_WHOLE_RECIPE } from "../../domain/training/recipes";
import type {
  WorkerHeartbeat,
  WorkerIdentity,
} from "../../domain/workers/schema";
import { imageBlobKey } from "../images/keys";
import { markImageUnclear } from "../images/public";
import { requireBlob } from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import { openModelWeights } from "../models/publication";
import { readModelVersion } from "../models/registry";
import { listTrainingRunSummaries } from "../queries/training-runs";
import {
  imageDigest,
  recordTestHeartbeat,
  reviewedDataset as reviewed,
  traditionalVersion,
  ULTRALYTICS_RUNTIME,
} from "../testing/fixtures";
import { trainingBundle } from "../testing/model-bundle";
import { removeWorker } from "../workers/public";
import {
  readTrainingArtifactParts,
  saveTrainingArtifactPart,
} from "./artifacts";
import { listTrainingAttempts } from "./attempts";
import { collectTrainingArtifactParts } from "./collection";
import { controlTrainingRun } from "./control";
import { listTrainingEpochs } from "./epochs";
import { artifactPartKey } from "./keys";
import { publishTrainingArtifact as publishTrainingBundle } from "./publication";
import {
  activeTrainingRun,
  claimTrainingRun,
  createTrainingRun,
  enterTrainingPhase,
  failTrainingRun,
  readTrainingRun,
  recordTrainingEpoch,
  renewTrainingLease,
} from "./runs";
import { readDatasetSnapshot } from "./snapshots";

async function publishTrainingArtifact(
  runId: string,
  owner: Parameters<typeof publishTrainingBundle>[1],
  weights: Uint8Array,
  publication: Parameters<typeof trainingBundle>[1],
) {
  const run = await readTrainingRun(runId);
  const snapshot = await readDatasetSnapshot(run!.datasetSnapshotId);
  const bundle = trainingBundle(
    weights,
    publication,
    snapshot!.classes,
    snapshot!.id,
  );
  if (run!.state.status !== "succeeded") {
    for (
      let offset = 0, part = 0;
      offset < weights.length;
      offset += TRAINING_ARTIFACT_PART_BYTES, part++
    ) {
      const chunk = weights.subarray(
        offset,
        offset + TRAINING_ARTIFACT_PART_BYTES,
      );
      await saveTrainingArtifactPart(
        runId,
        owner,
        bundle.weights,
        part,
        contentDigest(chunk),
        chunk,
      );
    }
  }
  return publishTrainingBundle(runId, owner, bundle);
}

const CONTENTS = ["first-image", "second-image"];

/** Publishing trains new versions, so these runs keep a model of their own. */
async function reviewedDataset(name: string) {
  const { dataset } = await reviewed(
    name,
    CONTENTS,
    await traditionalVersion("training-detector", "training-v1"),
  );
  return dataset;
}

function owner(
  workerId: string,
  sessionId = `${workerId}-session`,
  attempt = 1,
) {
  return { workerId, sessionId, attempt };
}

function heartbeat(identity: WorkerIdentity, startedAt: Date): WorkerHeartbeat {
  return {
    workerId: identity.workerId,
    sessionId: identity.sessionId,
    startedAt: startedAt.toISOString(),
    runtimes: [ULTRALYTICS_RUNTIME],
    memoryBytes: 24 * 1024 ** 3,
  };
}

async function trainer(workerId: string) {
  const identity = owner(workerId);
  await recordTestHeartbeat(heartbeat(identity, new Date()));
  return identity;
}

const recipe = {
  ...YOLO26N_WHOLE_RECIPE,
  parameters: {
    ...YOLO26N_WHOLE_RECIPE.parameters,
    epochs: 3,
    imgsz: 768,
    batch: 4,
  },
};

function epochReport(epoch: number) {
  return {
    epoch,
    train: {
      box: 1.5 / epoch,
      classification: 2 / epoch,
      regression: 1 / epoch,
    },
    val: {
      box: 1.6 / epoch,
      classification: 2.1 / epoch,
      regression: 1.1 / epoch,
    },
    precision: 0.2 * epoch,
    recall: 0.25 * epoch,
    map50: 0.3 * epoch,
    map50To95: 0.1 * epoch,
    fitness: 0.12 * epoch,
    learningRate: 0.001,
  };
}

const publication = {
  schemaVersion: 1 as const,
  weights: "weights/best.pt" as const,
  inference: {
    ready: true as const,
    confidence: 0.42,
    imageSize: 768,
    maxDetections: 500,
    endToEnd: false,
  },
  validation: {
    precision: 0.5,
    recall: 0.4,
    map50: 0.8,
    map50To95: 0.4,
    fitness: 0.44,
  },
  training: {
    baseModel: recipe.baseModel,
    parameters: recipe.parameters,
    runtime: recipe.runtime,
  },
};

test("a model has at most one active training run", async () => {
  const dataset = await reviewedDataset("exclusive-run");
  const run = await createTrainingRun(dataset.id, recipe);
  expect((await activeTrainingRun(run.modelId))?.id).toBe(run.id);
  await expect(createTrainingRun(dataset.id, recipe)).rejects.toThrow(
    /still active/,
  );
  const trainerOwner = await trainer("exclusive-trainer");
  expect((await claimTrainingRun(trainerOwner))?.id).toBe(run.id);
  await expect(createTrainingRun(dataset.id, recipe)).rejects.toThrow(
    /still active/,
  );
  await failTrainingRun(run.id, trainerOwner, "stopped");
  expect(await activeTrainingRun(run.modelId)).toBeNull();
  const next = await createTrainingRun(dataset.id, recipe);
  expect(next.id).not.toBe(run.id);
  expect((await claimTrainingRun(trainerOwner))?.id).toBe(next.id);
  await failTrainingRun(next.id, trainerOwner, "stopped");
  expect(
    (await listTrainingRunSummaries({ datasetId: dataset.id }))
      .map((summary) => summary.run.id)
      .sort(),
  ).toEqual([next.id, run.id].sort());
  await expect(
    listTrainingRunSummaries({ datasetId: dataset.id }, 101),
  ).rejects.toThrow(/between 1 and 100/);
});

test("concurrent claims lease a run to exactly one worker", async () => {
  const dataset = await reviewedDataset("contended-run");
  const run = await createTrainingRun(dataset.id, recipe);
  const workers = ["contender-1", "contender-2", "contender-3"];
  const owners = await Promise.all(workers.map(trainer));
  const claims = await Promise.all(
    owners.map((worker) => claimTrainingRun(worker)),
  );
  const winners = claims.filter((claimed) => claimed?.id === run.id);
  expect(winners).toHaveLength(1);
  expect(claims.filter((claimed) => claimed === null)).toHaveLength(2);
  const winner = winners[0];
  if (winner?.state.status !== "running") throw new Error("no lease");
  await failTrainingRun(
    run.id,
    {
      workerId: winner.state.workerId,
      sessionId: winner.state.sessionId,
      attempt: winner.attempt,
    },
    "stopped",
  );
});

test("a training run owns an immutable self-contained snapshot", async () => {
  const dataset = await reviewedDataset("snapshot-contract");
  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("snapshot-trainer");
  const claimed = await claimTrainingRun(owner("snapshot-trainer"));
  expect(claimed?.id).toBe(run.id);
  expect(await claimTrainingRun(owner("snapshot-trainer"))).toEqual(claimed);
  if (!claimed) throw new Error("run was not claimed");

  const snapshot = await readDatasetSnapshot(claimed.datasetSnapshotId);
  if (!snapshot) throw new Error("missing snapshot");
  expect(snapshot.images.map((image) => image.digest)).toEqual(
    (await Promise.all(CONTENTS.map(imageDigest))).sort(),
  );
  expect(new Set(snapshot.images.map((image) => image.split))).toEqual(
    new Set(["train", "val"]),
  );
  for (const image of snapshot.images) {
    expect(contentDigest(await requireBlob(imageBlobKey(image.digest)))).toBe(
      image.digest,
    );
    expect(image.annotation.image.digest).toBe(image.digest);
  }
  await expect(
    renewTrainingLease(run.id, owner("another-trainer")),
  ).rejects.toThrow(/not owned/);
  await failTrainingRun(run.id, owner("snapshot-trainer"), "stopped");
});

test("a snapshot takes an unclear photograph like any other", async () => {
  const contents = ["clear-image", "fogged-image"];
  const { dataset } = await reviewed(
    "unclear-snapshot",
    contents,
    await traditionalVersion("training-detector", "training-v1"),
  );
  const [clear, fogged] = await Promise.all(contents.map(imageDigest));
  await markImageUnclear({ digest: fogged! });

  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("unclear-trainer");
  const claimed = await claimTrainingRun(owner("unclear-trainer"));
  if (!claimed) throw new Error("run was not claimed");
  const snapshot = await readDatasetSnapshot(claimed.datasetSnapshotId);
  expect(snapshot?.images.map((image) => image.digest)).toEqual(
    [clear!, fogged!].sort(),
  );
  await failTrainingRun(run.id, owner("unclear-trainer"), "stopped");
});

test("publication registers one immutable version per training run", async () => {
  const dataset = await reviewedDataset("publish-contract");
  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("publisher");
  expect((await claimTrainingRun(owner("publisher")))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, owner("publisher"), "training");
  await enterTrainingPhase(run.id, owner("publisher"), "validating");

  const weights = new TextEncoder().encode("trained-weights");
  await expect(
    publishTrainingArtifact(run.id, owner("publisher"), weights, {
      ...publication,
      training: {
        ...publication.training,
        runtime: { ...publication.training.runtime, version: "different" },
      },
    }),
  ).rejects.toThrow(/identity does not match/);
  const completed = await publishTrainingArtifact(
    run.id,
    owner("publisher"),
    weights,
    publication,
  );
  const repeated = await publishTrainingArtifact(
    run.id,
    owner("publisher"),
    weights,
    publication,
  );
  expect(completed).toEqual(repeated);
  await expect(
    publishTrainingArtifact(
      run.id,
      owner("publisher"),
      new TextEncoder().encode("different-weights"),
      publication,
    ),
  ).rejects.toThrow(/different contents/);
  expect(completed.state.status).toBe("succeeded");
  if (completed.state.status !== "succeeded") throw new Error("not succeeded");

  const version = await readModelVersion(completed.state.modelVersionId);
  expect(version?.id).not.toBe(run.id);
  expect(version?.source).toEqual({
    kind: "training_run",
    trainingRunId: run.id,
    trainingAttempt: completed.attempt,
    datasetSnapshotId: run.datasetSnapshotId,
  });
  expect(version?.artifact.kind).toBe("ultralytics");
  if (
    version?.source.kind !== "training_run" ||
    version.artifact.kind !== "ultralytics"
  ) {
    throw new Error("missing ultralytics version");
  }
  expect(dataset.modelId).toBe(version.modelId);
  expect(
    new TextDecoder().decode(
      await new Response(
        (await openModelWeights(version.id)).stream,
      ).arrayBuffer(),
    ),
  ).toBe("trained-weights");
});

test("epochs carry the run's progress and a reclaimed attempt draws its own curve", async () => {
  const dataset = await reviewedDataset("epoch-history");
  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("epoch-trainer");
  await trainer("epoch-successor");
  const start = new Date();
  expect((await claimTrainingRun(owner("epoch-trainer"), start))?.id).toBe(
    run.id,
  );
  await expect(
    recordTrainingEpoch(run.id, owner("epoch-trainer"), epochReport(1), start),
  ).rejects.toThrow(/while preparing/);
  await enterTrainingPhase(run.id, owner("epoch-trainer"), "training", start);

  const first = await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(1),
    start,
  );
  expect(first.state).toMatchObject({ status: "running", phase: "training" });
  if (first.state.status !== "running") throw new Error("not running");
  expect(first.state.progress).toBeCloseTo(0.05 + 0.85 / 3);
  await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(2),
    start,
  );
  await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    { ...epochReport(2), fitness: 0.5 },
    start,
  );
  const renewed = await renewTrainingLease(
    run.id,
    owner("epoch-trainer"),
    start,
  );
  expect(renewed.state).toMatchObject({
    status: "running",
    phase: "training",
  });
  if (renewed.state.status !== "running") throw new Error("not running");
  expect(renewed.state.progress).toBeCloseTo(0.05 + (0.85 * 2) / 3);
  const repeatedEarlier = await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer"),
    epochReport(1),
    start,
  );
  if (repeatedEarlier.state.status !== "running")
    throw new Error("not running");
  expect(repeatedEarlier.state.progress).toBeCloseTo(0.05 + (0.85 * 2) / 3);
  await expect(
    recordTrainingEpoch(run.id, owner("epoch-trainer"), epochReport(4), start),
  ).rejects.toThrow(/has 3 epochs/);
  await expect(
    recordTrainingEpoch(
      run.id,
      owner("epoch-trainer", undefined, 2),
      epochReport(3),
      start,
    ),
  ).rejects.toThrow(/not owned/);

  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect(
    (await claimTrainingRun(owner("epoch-trainer", undefined, 2), expired))?.id,
  ).toBe(run.id);
  await enterTrainingPhase(
    run.id,
    owner("epoch-trainer", undefined, 2),
    "training",
    expired,
  );
  await recordTrainingEpoch(
    run.id,
    owner("epoch-trainer", undefined, 2),
    epochReport(1),
    expired,
  );

  const history = await listTrainingEpochs(run.id);
  expect(history.map(({ epoch, fitness }) => [epoch, fitness])).toEqual([
    [1, 0.12],
  ]);
  expect(history[0]).toMatchObject({
    train: { box: 1.5, classification: 2, regression: 1 },
    val: { box: 1.6, classification: 2.1, regression: 1.1 },
    map50: 0.3,
    learningRate: 0.001,
  });
  expect(
    await listTrainingRunSummaries({ datasetId: dataset.id }, 1),
  ).toMatchObject([
    {
      dataset: { id: dataset.id, name: "epoch-history" },
      run: { id: run.id },
      completed: 1,
      best: { map50: 0.3, map50To95: 0.1 },
    },
  ]);
  const validating = await enterTrainingPhase(
    run.id,
    owner("epoch-trainer", undefined, 2),
    "validating",
    expired,
  );
  expect(validating.state).toMatchObject({
    status: "running",
    phase: "validating",
    progress: 0.9,
  });
  await expect(
    enterTrainingPhase(
      run.id,
      owner("epoch-trainer", undefined, 2),
      "training",
      expired,
    ),
  ).rejects.toThrow(/cannot move/);
  await expect(
    recordTrainingEpoch(
      run.id,
      owner("epoch-trainer", undefined, 2),
      epochReport(2),
      expired,
    ),
  ).rejects.toThrow(/while validating/);
  await failTrainingRun(
    run.id,
    owner("epoch-trainer", undefined, 2),
    "stopped",
  );
});

test("an expired attempt cannot report after the same worker reclaims its run", async () => {
  const dataset = await reviewedDataset("missing-lease");
  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("slow-trainer");
  await trainer("fast-trainer");
  const start = new Date();
  expect((await claimTrainingRun(owner("slow-trainer"), start))?.id).toBe(
    run.id,
  );
  const expired = new Date(start.getTime() + 10 * 60 * 1000);
  expect(await claimTrainingRun(owner("fast-trainer"), expired)).toBeNull();
  expect(
    (await claimTrainingRun(owner("slow-trainer", undefined, 2), expired))?.id,
  ).toBe(run.id);
  await expect(
    renewTrainingLease(run.id, owner("slow-trainer")),
  ).rejects.toThrow(/not owned/);
  await expect(
    failTrainingRun(run.id, owner("slow-trainer"), "late"),
  ).rejects.toThrow(/not owned/);
  await failTrainingRun(run.id, owner("slow-trainer", undefined, 2), "stopped");
});

test("a restarted worker reclaims its run as a new fenced attempt", async () => {
  const dataset = await reviewedDataset("restarted-worker");
  const run = await createTrainingRun(dataset.id, recipe);
  const oldSession = owner("restarting-trainer", "session-old");
  const newSession = {
    ...owner("restarting-trainer", "session-new"),
    attempt: 2,
  };
  const started = new Date();
  await recordTestHeartbeat(heartbeat(oldSession, started), started);
  expect((await claimTrainingRun(oldSession, started))?.attempt).toBe(1);

  const restarted = new Date(started.getTime() + 1_000);
  await recordTestHeartbeat(heartbeat(newSession, restarted), restarted);
  await expect(
    renewTrainingLease(run.id, oldSession, restarted),
  ).rejects.toThrow(/not owned/);
  const reclaimed = await claimTrainingRun(newSession, restarted);
  expect(reclaimed).toMatchObject({
    id: run.id,
    attempt: 2,
    state: { status: "running", phase: "preparing" },
  });
  await expect(
    recordTestHeartbeat(heartbeat(oldSession, started), restarted),
  ).rejects.toThrow(/newer active session/);
  await failTrainingRun(run.id, newSession, "stopped");
});

test("a removed worker requires explicit restart before its run can move", async () => {
  const dataset = await reviewedDataset("removed-worker");
  const run = await createTrainingRun(dataset.id, recipe);
  await trainer("removed-trainer");
  await trainer("remaining-trainer");
  const at = new Date();
  expect((await claimTrainingRun(owner("removed-trainer"), at))?.id).toBe(
    run.id,
  );
  await removeWorker("removed-trainer");
  expect(await claimTrainingRun(owner("remaining-trainer"), at)).toBeNull();
  await controlTrainingRun(dataset.id, run.id, 1, { action: "pause" });
  await controlTrainingRun(dataset.id, run.id, 1, {
    action: "resume",
    targetWorkerId: "remaining-trainer",
    restart: true,
  });
  expect(
    await claimTrainingRun(owner("remaining-trainer", undefined, 2), at),
  ).toMatchObject({
    id: run.id,
    attempt: 2,
  });
  await failTrainingRun(
    run.id,
    owner("remaining-trainer", undefined, 2),
    "stopped",
  );
});

test("pause releases the model and fences the previous attempt even on the same worker session", async () => {
  const dataset = await reviewedDataset("controlled-training");
  const a = await trainer("controlled-a");
  const b = await trainer("controlled-b");
  const run = await createTrainingRun(dataset.id, recipe, a.workerId);
  expect(await claimTrainingRun(b)).toBeNull();
  expect((await claimTrainingRun(a))?.id).toBe(run.id);
  await enterTrainingPhase(run.id, a, "training");
  await recordTrainingEpoch(run.id, a, epochReport(1));
  const before = await readTrainingRun(run.id);
  await renewTrainingLease(run.id, a);
  expect((await readTrainingRun(run.id))?.lastProgressAt).toBe(
    before?.lastProgressAt,
  );
  const otherDataset = await reviewedDataset("other-controlled-training");
  await expect(
    controlTrainingRun(otherDataset.id, run.id, 1, { action: "pause" }),
  ).rejects.toThrow(/not found/);
  expect((await readTrainingRun(run.id))?.state.status).toBe("running");
  await controlTrainingRun(dataset.id, run.id, 1, { action: "pause" });
  expect(await activeTrainingRun(run.modelId)).toBeNull();
  expect(await claimTrainingRun(b)).toBeNull();
  await expect(recordTrainingEpoch(run.id, a, epochReport(2))).rejects.toThrow(
    /not owned/,
  );
  await controlTrainingRun(dataset.id, run.id, 1, {
    action: "resume",
    targetWorkerId: a.workerId,
    restart: false,
  });
  expect((await claimTrainingRun(a))?.attempt).toBe(2);
  await expect(renewTrainingLease(run.id, a)).rejects.toThrow(/not owned/);
  await expect(failTrainingRun(run.id, a, "late failure")).rejects.toThrow(
    /not owned/,
  );
  await expect(
    publishTrainingArtifact(run.id, a, new Uint8Array([1]), publication),
  ).rejects.toThrow(/not owned/);
  await expect(
    controlTrainingRun(dataset.id, run.id, 1, { action: "cancel" }),
  ).rejects.toThrow(/refresh/);
  await controlTrainingRun(dataset.id, run.id, 2, { action: "cancel" });
  expect(await listTrainingAttempts(run.id)).toMatchObject([
    { attempt: 2, workerId: a.workerId, outcome: "cancelled" },
    { attempt: 1, workerId: a.workerId, outcome: "paused" },
  ]);
  await expect(
    controlTrainingRun(dataset.id, run.id, 2, {
      action: "resume",
      targetWorkerId: null,
      restart: false,
    }),
  ).rejects.toThrow(/Only paused or failed/);
});

test("local progress pins resume to its worker, while explicit restart can move", async () => {
  const dataset = await reviewedDataset("local-training");
  const a = await trainer("local-a");
  const b = await trainer("local-b");
  const run = await createTrainingRun(dataset.id, recipe);
  await claimTrainingRun(a);
  await enterTrainingPhase(run.id, a, "training");
  const reported = await recordTrainingEpoch(run.id, a, epochReport(1));
  expect(reported.checkpoint).toEqual({
    attempt: 1,
    epoch: 1,
    workerId: a.workerId,
  });
  await controlTrainingRun(dataset.id, run.id, 1, { action: "pause" });
  await expect(
    controlTrainingRun(dataset.id, run.id, 1, {
      action: "resume",
      targetWorkerId: b.workerId,
      restart: false,
    }),
  ).rejects.toThrow(/original worker/);
  await controlTrainingRun(dataset.id, run.id, 1, {
    action: "resume",
    targetWorkerId: null,
    restart: false,
  });
  expect(await claimTrainingRun(b)).toBeNull();
  const resumed = await claimTrainingRun(a);
  expect(resumed?.attempt).toBe(2);
  expect(resumed?.checkpoint).toEqual(reported.checkpoint);
  await controlTrainingRun(dataset.id, run.id, 2, { action: "pause" });
  await controlTrainingRun(dataset.id, run.id, 2, {
    action: "resume",
    targetWorkerId: b.workerId,
    restart: true,
  });
  const restarted = await claimTrainingRun(b);
  expect(restarted?.checkpoint).toBeNull();
  expect(restarted?.state.status).toBe("running");
  await controlTrainingRun(dataset.id, run.id, 3, { action: "cancel" });
});

test("final artifact parts verify size and integrity before assembly and expire with the attempt", async () => {
  const dataset = await reviewedDataset("artifact-parts");
  const a = await trainer("artifact-parts-a");
  const run = await createTrainingRun(dataset.id, recipe, a.workerId);
  await claimTrainingRun(a);
  const bytes = new Uint8Array(TRAINING_ARTIFACT_PART_BYTES + 3).fill(42);
  const upload = { bytes: bytes.length, digest: contentDigest(bytes) };
  const first = bytes.subarray(0, TRAINING_ARTIFACT_PART_BYTES);
  const last = bytes.subarray(TRAINING_ARTIFACT_PART_BYTES);
  const put = (
    part: number,
    chunk: Uint8Array,
    digest = contentDigest(chunk),
  ) => saveTrainingArtifactPart(run.id, a, upload, part, digest, chunk);
  await expect(put(0, first, "0".repeat(64))).rejects.toThrow(/digest/);
  await expect(put(0, last)).rejects.toThrow(/size/);
  await put(0, first);
  await put(0, first);
  await expect(put(0, new Uint8Array(first.length).fill(43))).rejects.toThrow(
    /different contents/,
  );
  await expect(readTrainingArtifactParts(run.id, a, upload)).rejects.toThrow(
    /missing/,
  );
  await put(1, last);
  expect(await readTrainingArtifactParts(run.id, a, upload)).toEqual(bytes);
  expect(await collectTrainingArtifactParts()).not.toContain(
    artifactPartKey(run.id, 1, upload, 0),
  );
  await controlTrainingRun(dataset.id, run.id, 1, { action: "pause" });
  await expect(put(1, last)).rejects.toThrow(/not owned/);
  expect(await collectTrainingArtifactParts()).toContain(
    artifactPartKey(run.id, 1, upload, 0),
  );
});

test("an expired lease cannot be renewed or publish before another worker claims it", async () => {
  const dataset = await reviewedDataset("expired-authority");
  const a = await trainer("expired-authority-worker");
  const run = await createTrainingRun(dataset.id, recipe);
  await claimTrainingRun(a, new Date(Date.now() - 6 * 60_000));
  await expect(renewTrainingLease(run.id, a)).rejects.toThrow(/not owned/);
  await expect(
    publishTrainingArtifact(run.id, a, new Uint8Array([1]), publication),
  ).rejects.toThrow(/not owned/);
  await controlTrainingRun(dataset.id, run.id, 1, { action: "cancel" });
});

test("pausing and model publication serialize to one consistent outcome", async () => {
  const dataset = await reviewedDataset("pause-publication");
  const a = await trainer("pause-publication-worker");
  const run = await createTrainingRun(dataset.id, recipe);
  await claimTrainingRun(a);
  const results = await Promise.allSettled([
    controlTrainingRun(dataset.id, run.id, 1, { action: "pause" }),
    publishTrainingArtifact(run.id, a, new Uint8Array([1]), publication),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const current = await readTrainingRun(run.id);
  if (
    !current ||
    (current.state.status !== "paused" && current.state.status !== "succeeded")
  )
    throw new Error("Unexpected training outcome");
  expect((await listTrainingAttempts(run.id))[0]?.outcome).toBe(
    current.state.status,
  );
  expect(await activeTrainingRun(run.modelId)).toBeNull();
});

test("owned writes refuse a missing run as an ownership conflict", async () => {
  const worker = await trainer("missing-run-worker");
  await expect(
    enterTrainingPhase("missing-run", worker, "training"),
  ).rejects.toThrow(TrainingRunConflictError);
  await expect(
    recordTrainingEpoch("missing-run", worker, epochReport(1)),
  ).rejects.toThrow(TrainingRunConflictError);
  await expect(
    failTrainingRun("missing-run", worker, "failed"),
  ).rejects.toThrow(TrainingRunConflictError);
  await expect(renewTrainingLease("missing-run", worker)).rejects.toThrow(
    TrainingRunConflictError,
  );
});
