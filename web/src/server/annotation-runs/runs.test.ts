import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { StartAnnotationRun } from "../../domain/annotation-runs/schema";
import { modelAnnotationRequestSchema } from "../../domain/models/schema";
import { database } from "../infra/db/client";
import { annotationRuns } from "../infra/db/schema";
import { createModel, setModelAnnotation } from "../models/public";
import { readReview } from "../readings/public";
import { observeImages } from "../testing/experiments";
import { cancelAnnotationRun, createAnnotationRun } from "./runs";
import { nextAnnotationTask, savePreview, submitProposal } from "./tasks";

async function stored(id: string) {
  const [row] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, id));
  return row!;
}

async function setup(name: string) {
  const observed = await observeImages(name, [name, `${name}-other`]);
  const request = {
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    input: null,
    scope: null,
  } satisfies StartAnnotationRun;
  return { request, digests: observed.digests };
}
test("the model's instructions and region are frozen into the run definition", async () => {
  const { request, digests } = await setup("ai-region");
  const model = await createModel({
    id: "ai-region-model",
    name: "Region model",
    classes: ["ungerminated", "germinated"],
  });
  const ref = { digest: digests[0]!, modelId: model.id };
  await expect(createAnnotationRun({ ...request, ref })).rejects.toThrow(
    "no annotation instructions",
  );
  const annotation = {
    area: "image" as const,
    instructions: "Box every seed.",
    coreSize: 16,
    halo: 8,
    displayScale: 4,
  };
  await setModelAnnotation({ model: model.id, annotation });
  expect(() =>
    modelAnnotationRequestSchema.parse({
      model: model.id,
      annotation: { ...annotation, halo: 17 },
    }),
  ).toThrow("Context cannot exceed core size");
  const run = await createAnnotationRun({ ...request, ref });
  const { definition } = await stored(run.id);
  expect(definition.config).toEqual({
    area: "image",
    classes: ["ungerminated", "germinated"],
    rules: annotation.instructions,
    coreSize: 16,
    halo: 8,
    displayScale: 4,
  });
  expect(run.progress.total).toBe(
    Math.ceil(definition.image.width / 16) *
      Math.ceil(definition.image.height / 16),
  );
  await cancelAnnotationRun(ref);
});
test("a run stays open between conversations, and any agent continues it by its image", async () => {
  const { request: base } = await setup("ai-open");
  const model = await createModel({
    id: "ai-open-model",
    name: "Open model",
    classes: ["ungerminated", "germinated"],
    annotation: {
      area: "image",
      instructions: "Box every seed.",
      coreSize: 16,
      halo: 8,
      displayScale: 1,
    },
  });
  const request = { ...base, ref: { ...base.ref, modelId: model.id } };
  const run = await createAnnotationRun(request);
  const shown = async () =>
    (await readReview(request.ref, "open.jpg", await database()))?.progress;
  expect(await shown()).toEqual({ completed: 0, total: run.progress.total });
  const next = await nextAnnotationTask(request.ref);
  expect(next.taskId).toStartWith(`${run.id}/`);
  expect(await nextAnnotationTask(request.ref)).toEqual(next);
  await expect(createAnnotationRun(request)).rejects.toThrow("in progress");
  const preview = await savePreview(next.taskId, { instances: [] });
  await submitProposal(next.taskId, preview.proposalId);
  expect(await shown()).toEqual({ completed: 1, total: run.progress.total });
  expect((await nextAnnotationTask(request.ref)).taskId).not.toBe(next.taskId);
  await cancelAnnotationRun(request.ref);
  expect((await stored(run.id)).status).toBe("cancelled");
  expect(await shown()).toBeNull();
  await expect(nextAnnotationTask(request.ref)).rejects.toThrow(
    "No AI annotation run is in progress",
  );
  await expect(cancelAnnotationRun(request.ref)).rejects.toThrow(
    "No AI annotation run is in progress",
  );
  const again = await createAnnotationRun(request);
  expect(again.progress.completed).toBe(0);
  await cancelAnnotationRun(request.ref);
});

test("dish runs freeze coverage and actual task totals while later model edits leave them unchanged", async () => {
  const { request } = await setup("dish-plan");
  const { default: sharp } = await import("sharp");
  const { storeImage } = await import("../images/public");
  const { annotationTasks } = await import("../infra/db/schema");
  const pixels = await sharp(
    Buffer.from(
      '<svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><circle cx="500" cy="500" r="350" stroke="black" stroke-width="8" fill="none"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Dish plan",
    classes: ["ungerminated", "germinated"],
    annotation: {
      instructions: "Box each seed",
      area: "dish",
      coreSize: 100,
      halo: 32,
      displayScale: 1,
    },
  });
  const ref = { modelId: model.id, digest: (await storeImage(pixels)).digest };
  const run = await createAnnotationRun({ ...request, ref });
  const before = await stored(run.id);
  expect(before.definition.coverage).not.toBeNull();
  expect(run.progress.total).toBeLessThan(100);
  const tasks = await (
    await database()
  )
    .select()
    .from(annotationTasks)
    .where(eq(annotationTasks.runId, run.id));
  expect(tasks).toHaveLength(run.progress.total);
  expect(tasks.some((task) => task.region.id === "tile-000-000")).toBe(false);
  await setModelAnnotation({
    model: model.id,
    annotation: { ...model.annotation, area: "image" },
  });
  expect((await stored(run.id)).definition).toEqual(before.definition);
  await cancelAnnotationRun(ref);
  const next = await createAnnotationRun({ ...request, ref });
  expect(next.progress.total).toBe(100);
  expect((await stored(next.id)).definition.coverage).toBeNull();
  await cancelAnnotationRun(ref);
});

test("starting a run never waits for image processing or creates regional evidence", async () => {
  const { request } = await setup("start-no-images");
  const { processImage } = await import("../images/processing");
  const { listBlobs } = await import("../infra/blobs/store");
  const prefix = `image-regions/${request.ref.digest}/`;
  expect(await listBlobs(prefix)).toEqual([]);
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = processImage(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await ready;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = await Promise.race([
      createAnnotationRun(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Starting a run waited for image processing")),
          2000,
        );
      }),
    ]);
    expect(run.progress.total).toBeGreaterThan(0);
    expect(await listBlobs(prefix)).toEqual([]);
    await cancelAnnotationRun(request.ref);
  } finally {
    clearTimeout(timer);
    release();
    await blocked;
  }
});

test("starting on an absent canonical image uses the shared image refusal", async () => {
  await expect(
    createAnnotationRun({
      ref: { digest: "0".repeat(64), modelId: "seed-detector" },
      input: null,
      scope: null,
    }),
  ).rejects.toMatchObject({ code: "image_not_found" });
});
