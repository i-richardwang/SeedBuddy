import { expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import type { DetectionResult } from "../../domain/detection/schema";
import type { InferenceAssignment } from "../../domain/inference/assignments";
import { InferenceAttemptConflictError } from "../../domain/inference/errors";
import type { Worker } from "../../domain/workers/schema";
import { database } from "../infra/db/client";
import { inferenceTasks } from "../infra/db/schema";
import { listWorkerOverviews } from "../queries/public";
import { snapshotImages } from "../testing/datasets";
import { observeImages } from "../testing/experiments";
import { FIXTURE_EDGE } from "../testing/images";
import { registerTrainedVersion, traditionalVersion } from "../testing/models";
import {
  recordTestHeartbeat,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
} from "../testing/workers";
import { removeWorker } from "../workers/public";
import {
  claimInferenceAssignment,
  completeInferenceClaim,
  failInferenceAttempt,
  renewInferenceClaim,
} from "./attempts";
import { INFERENCE_LEASE_SECONDS } from "./policy";
import {
  maintainInferenceTasks,
  readInferenceTask,
  retryInferenceTask,
} from "./tasks";

const start = new Date("2030-01-01T00:00:00Z");
const later = (seconds: number) => new Date(start.getTime() + seconds * 1000);
const target = (a: InferenceAssignment) => ({
  versionId: a.manifest.modelVersionId,
  digest: a.image,
});
const owner = (a: InferenceAssignment, w: Worker) => ({
  workerId: w.workerId,
  sessionId: w.sessionId,
  attempt: a.attempt,
});
function result(a: InferenceAssignment, worker: Worker): DetectionResult {
  return {
    schemaVersion: 1,
    image: { digest: a.image, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    producer: {
      modelVersionId: a.manifest.modelVersionId,
      artifactDigest: a.manifest.artifact.digest,
      runtime: worker.runtimes.find(
        (r) => r.adapter === a.manifest.artifact.kind,
      )!,
    },
    instances: [],
    quality: { status: "ok", warnings: [] },
  };
}
async function worker(name: string) {
  return recordTestHeartbeat({
    ...testHeartbeat(name),
    runtimes: [...testHeartbeat(name).runtimes, ULTRALYTICS_RUNTIME],
  });
}
async function claimImage(
  w: Worker,
  digest: string,
  at = start,
): Promise<InferenceAssignment> {
  for (let n = 0; n < 1000; n++) {
    const a = await claimInferenceAssignment(w, at);
    if (!a) throw new Error(`No work for ${digest}`);
    if (a.image === digest) return a;
    await completeInferenceClaim(target(a), result(a, w), owner(a, w), at);
  }
  throw new Error("Could not reach test image");
}
async function setup(name: string) {
  const { digests } = await observeImages(name, [name]);
  const w = await worker(name);
  const a = await claimImage(w, digests[0]!);
  return { w, a, t: target(a), o: owner(a, w) };
}

test("a slot returns its existing attempt on a repeated claim; another worker can take the next image", async () => {
  const { w, a } = await setup("single-slot");
  await observeImages("single-slot-next", ["single-slot-next"]);
  const same = await claimInferenceAssignment(w, later(1));
  expect(same?.attempt).toBe(a.attempt);
  expect(same?.image).toBe(a.image);
  expect(same?.deadlineAt).toBe(a.deadlineAt);
  const other = await claimInferenceAssignment(
    await worker("single-slot-other"),
    later(1),
  );
  expect(other).not.toBeNull();
  expect(target(other!)).not.toEqual(target(a));
});

test("offline ownership expires and is reclaimed without a maintenance process", async () => {
  const { a, t, o } = await setup("offline");
  const second = await worker("offline-other");
  await claimInferenceAssignment(second, later(INFERENCE_LEASE_SECONDS + 1));
  const resumed = await claimImage(
    second,
    a.image,
    later(INFERENCE_LEASE_SECONDS + 7),
  );
  expect(resumed.attempt).toBe(a.attempt + 1);
  await expect(renewInferenceClaim(t, o, later(100))).rejects.toBeInstanceOf(
    InferenceAttemptConflictError,
  );
  const state = await readInferenceTask(t);
  expect(state?.attempts[0]?.failure?.code).toBe("lease_expired");
});

test("heartbeats and renewals cannot extend a stuck execution beyond its fixed deadline", async () => {
  const { w, a, t, o } = await setup("stuck");
  const deadline = new Date(a.deadlineAt);
  for (
    let ms = start.getTime() + 30_000;
    ms < deadline.getTime();
    ms += 30_000
  ) {
    const receipt = await renewInferenceClaim(t, o, new Date(ms));
    expect(receipt.deadlineAt).toBe(a.deadlineAt);
    expect(new Date(receipt.leaseExpiresAt).getTime()).toBeLessThanOrEqual(
      deadline.getTime(),
    );
  }
  await expect(renewInferenceClaim(t, o, deadline)).rejects.toBeInstanceOf(
    InferenceAttemptConflictError,
  );
  await expect(
    completeInferenceClaim(t, result(a, w), o, deadline),
  ).rejects.toBeInstanceOf(InferenceAttemptConflictError);
  await maintainInferenceTasks(deadline);
  expect((await readInferenceTask(t))?.attempts[0]?.failure?.code).toBe(
    "timeout",
  );
  const second = await worker("stuck-other");
  const resumed = await claimImage(
    second,
    a.image,
    new Date(deadline.getTime() + 6000),
  );
  expect(resumed.attempt).toBe(a.attempt + 1);
  await expect(
    completeInferenceClaim(
      t,
      result(a, w),
      o,
      new Date(deadline.getTime() + 7000),
    ),
  ).rejects.toBeInstanceOf(InferenceAttemptConflictError);
});

test("a new attempt fences the old attempt even within the same worker session", async () => {
  const { w, a, t, o } = await setup("same-session");
  await failInferenceAttempt(
    t,
    { code: "execution", message: "GPU failed" },
    o,
    later(1),
  );
  const next = await claimImage(w, a.image, later(62));
  expect(next.attempt).toBe(a.attempt + 1);
  await expect(renewInferenceClaim(t, o, later(63))).rejects.toBeInstanceOf(
    InferenceAttemptConflictError,
  );
  await expect(
    completeInferenceClaim(t, result(a, w), o, later(63)),
  ).rejects.toBeInstanceOf(InferenceAttemptConflictError);
  await completeInferenceClaim(t, result(next, w), owner(next, w), later(63));
});

test("success receipt replay survives a lost response and lease expiry; a different payload is refused", async () => {
  const { w, a, t, o } = await setup("receipt");
  const body = result(a, w);
  await completeInferenceClaim(t, body, o, later(1));
  await completeInferenceClaim(t, body, o, later(10000));
  await expect(
    completeInferenceClaim(
      t,
      { ...body, quality: { status: "review_required", warnings: [] } },
      o,
      later(10000),
    ),
  ).rejects.toBeInstanceOf(InferenceAttemptConflictError);
  expect((await readInferenceTask(t))?.status).toBe("succeeded");
  expect((await readInferenceTask(t))?.attempts).toHaveLength(1);
});

test("transient failure retries finitely, cools the worker, and manual retry preserves history", async () => {
  const { w, a, t } = await setup("retry-budget");
  let current = a;
  for (let i = 0; i < 3; i++) {
    const failure = {
      code: "transport" as const,
      message: "image transfer failed",
    };
    await failInferenceAttempt(
      t,
      failure,
      owner(current, w),
      later(i * 70 + 1),
    );
    await failInferenceAttempt(
      t,
      failure,
      owner(current, w),
      later(i * 70 + 2),
    );
    expect(await claimInferenceAssignment(w, later(i * 70 + 3))).toBeNull();
    if (i < 2) current = await claimImage(w, a.image, later((i + 1) * 70));
  }
  const failed = await readInferenceTask(t);
  expect(failed?.status).toBe("failed");
  expect(failed?.attempts).toHaveLength(3);
  await maintainInferenceTasks(later(300));
  expect((await readInferenceTask(t))?.status).toBe("failed");
  await retryInferenceTask(t);
  const retried = await claimImage(
    await worker("retry-budget-fresh"),
    a.image,
    later(301),
  );
  expect(retried.attempt).toBe(4);
  expect((await readInferenceTask(t))?.attemptsInCycle).toBe(1);
  expect((await readInferenceTask(t))?.attempts).toHaveLength(4);
});

test("worker cooldown survives a session restart while another worker takes over", async () => {
  const { w, a, t, o } = await setup("restart-cooldown");
  await failInferenceAttempt(
    t,
    { code: "transport", message: "Disconnected" },
    o,
    later(1),
  );
  const restarted = await recordTestHeartbeat({
    ...w,
    sessionId: crypto.randomUUID(),
    startedAt: later(2).toISOString(),
  });
  expect(await claimInferenceAssignment(restarted, later(7))).toBeNull();
  const replacement = await claimImage(
    await worker("restart-cooldown-other"),
    a.image,
    later(7),
  );
  expect(replacement.attempt).toBe(a.attempt + 1);
  const { digests } = await observeImages("cooldown-ended", ["cooldown-ended"]);
  expect((await claimImage(restarted, digests[0]!, later(62))).image).toBe(
    digests[0]!,
  );
});

test("permanent failure terminates immediately and is visible as a task failure", async () => {
  const { t, o } = await setup("bad-input");
  await failInferenceAttempt(
    t,
    { code: "invalid_input", message: "Source image is invalid" },
    o,
    later(1),
  );
  expect((await readInferenceTask(t))?.status).toBe("failed");
});

test("worker removal preserves task and attempt history and permits reassignment", async () => {
  const { w, a, t } = await setup("removed-inference");
  await removeWorker(w.workerId);
  await maintainInferenceTasks(later(1));
  const resumed = await claimImage(
    await worker("removed-inference-other"),
    a.image,
    later(7),
  );
  expect(resumed.attempt).toBe(a.attempt + 1);
  expect((await readInferenceTask(t))?.attempts[0]?.workerId).toBe(w.workerId);
});

test("concurrent completion and expiry leave one coherent terminal attempt", async () => {
  const { w, a, t, o } = await setup("completion-race");
  await Promise.allSettled([
    completeInferenceClaim(t, result(a, w), o, later(1)),
    maintainInferenceTasks(later(91)),
  ]);
  const state = await readInferenceTask(t);
  expect(["succeeded", "queued"]).toContain(state!.status);
  expect(state?.attempts[0]?.status).not.toBe("running");
});

test("candidate evaluation materializes only validation images", async () => {
  const baseline = await traditionalVersion(
    "evaluation-tasks",
    "evaluation-baseline",
  );
  const candidate = await registerTrainedVersion(
    "evaluation-tasks",
    "evaluation-candidate",
  );
  const [val, train] = await snapshotImages(candidate, [
    { content: "evaluation-val", split: "val", reviewed: { ungerminated: 1 } },
    {
      content: "evaluation-train",
      split: "train",
      reviewed: { ungerminated: 1 },
    },
  ]);
  await maintainInferenceTasks(start);
  for (const versionId of [baseline.id, candidate.id]) {
    expect(await readInferenceTask({ versionId, digest: val! })).not.toBeNull();
    expect(await readInferenceTask({ versionId, digest: train! })).toBeNull();
  }
});

test("expired attempts do not appear as active recognition on the status page", async () => {
  const { t, o } = await setup("status-expired");
  // End the attempt through the public transition; the roster remains independent.
  await failInferenceAttempt(
    t,
    { code: "execution", message: "stopped" },
    o,
    later(1),
  );
  expect(
    (await listWorkerOverviews()).workers.find((w) => w.workerId === o.workerId)
      ?.activity,
  ).toBeNull();
  expect(
    await (
      await database()
    )
      .select()
      .from(inferenceTasks)
      .where(
        and(
          eq(inferenceTasks.imageId, t.digest),
          eq(inferenceTasks.modelVersionId, t.versionId),
        ),
      ),
  ).toHaveLength(1);
});

test("concurrent claims serialize one slot and distribute different slots without duplicates", async () => {
  await observeImages("parallel-slots", [
    "parallel-a",
    "parallel-b",
    "parallel-c",
  ]);
  const one = await worker("parallel-one");
  const two = await worker("parallel-two");
  const [first, repeated] = await Promise.all([
    claimInferenceAssignment(one, later(4000)),
    claimInferenceAssignment(one, later(4000)),
  ]);
  expect(first).not.toBeNull();
  expect(repeated).toEqual(first);
  const [held, other] = await Promise.all([
    claimInferenceAssignment(one, later(4001)),
    claimInferenceAssignment(two, later(4001)),
  ]);
  expect(held).not.toBeNull();
  expect(other).not.toBeNull();
  expect(target(held!)).not.toEqual(target(other!));
});

test("renewal racing reclamation cannot both succeed and lose its lease", async () => {
  const { t, o } = await setup("renew-race");
  const [renewed] = await Promise.allSettled([
    renewInferenceClaim(t, o, later(80)),
    maintainInferenceTasks(later(91)),
  ]);
  const task = await readInferenceTask(t);
  if (renewed.status === "fulfilled") {
    expect(task?.status).toBe("running");
    expect(task?.attempts[0]?.leaseExpiresAt).toBe(later(170).toISOString());
  } else {
    expect(task?.status).toBe("queued");
  }
});
