import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../domain/annotation-runs/errors";
import { storeAnnotation } from "../annotations/documents";
import { storeImage } from "../images/public";
import { database } from "../infra/db/client";
import { annotationRuns } from "../infra/db/schema";
import { createModel, setModelAnnotation } from "../models/public";
import { readAnnotationReading } from "../readings/public";
import { observeImages } from "../testing/experiments";
import { readAnnotation } from "../testing/records";
import { readTask } from "./access";
import { cancelAnnotationRun, createAnnotationRun } from "./runs";
import { nextAnnotationTask, savePreview, submitProposal } from "./tasks";
import {
  previewAnnotationTask,
  readAnnotationContext,
  viewAnnotationTask,
} from "./views";

async function setup(name: string) {
  const observed = await observeImages(name, [name]);
  const ref = {
    digest: observed.digests[0]!,
    modelId: observed.version.modelId,
  };
  const run = await createAnnotationRun({ ref, input: null, scope: null });
  return { run, ref };
}
const proposal = {
  instances: [
    { id: "s1", class: "ungerminated", box_2d: [100, 100, 300, 300] },
  ],
};

test("image-to-preview-to-submit is durable, idempotent and remains an unreviewed proposal", async () => {
  const { run, ref } = await setup("remote-flow");
  const next = await nextAnnotationTask(ref);
  expect(await nextAnnotationTask(ref)).toEqual(next);
  const taskId = next.taskId;
  const access = await readTask(taskId);
  const context = await readAnnotationContext(taskId);
  expect(context.filter((item) => item.kind === "image")).toHaveLength(1);
  expect(context[0]).toMatchObject({
    kind: "description",
    value: {
      contextId: run.id,
      classes: access.run.definition.config.classes,
      rules: access.run.definition.config.rules,
    },
  });
  const content = await viewAnnotationTask(taskId);
  expect(content[0]).toMatchObject({
    kind: "description",
    value: {
      contextId: run.id,
      core: access.task.region.core,
      patch: access.task.region.patch,
    },
  });
  const pictures = content.filter((i) => i.kind === "image");
  expect(pictures).toHaveLength(1);
  const dimensions = await sharp(pictures[0]!.bytes).metadata();
  expect(dimensions.width).toBe(
    access.task.region.patch.width * access.run.definition.config.displayScale,
  );
  expect((await nextAnnotationTask(ref)).completed).toBe(0);
  const preview = await previewAnnotationTask(taskId, proposal);
  expect(preview.panels.filter((i) => i.kind === "image")).toHaveLength(2);
  const repeated = await previewAnnotationTask(taskId, proposal);
  expect(repeated.proposalId).toBe(preview.proposalId);
  expect(repeated.panels.filter((i) => i.kind === "image")[1]!.bytes).toBe(
    preview.panels.filter((i) => i.kind === "image")[1]!.bytes,
  );
  const replies = await Promise.all([
    submitProposal(taskId, preview.proposalId),
    submitProposal(taskId, preview.proposalId),
  ]);
  expect(replies[0]).toEqual(replies[1]);
  expect(replies[0]?.status).toBe("succeeded");
  await expect(nextAnnotationTask(ref)).rejects.toThrow(
    "No AI annotation run is in progress",
  );
  expect(await readAnnotation(ref)).toBeNull();
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, run.id));
  expect(stored!.result!.document.instances[0]!.bbox.x).toBe(
    access.run.definition.image.width * 0.1,
  );
  await expect(submitProposal(taskId, "f".repeat(64))).rejects.toThrow(
    "different proposal",
  );
});

test("classes, finite geometry, preview identity and task identity are enforced", async () => {
  const { ref } = await setup("remote-validation");
  const taskId = (await nextAnnotationTask(ref)).taskId;
  await expect(
    savePreview(taskId, {
      instances: [{ ...proposal.instances[0], class: "weed" }],
    }),
  ).rejects.toThrow("Unknown annotation class");
  await expect(
    savePreview(taskId, {
      instances: [{ ...proposal.instances[0], box_2d: [100, 100, 1001, 300] }],
    }),
  ).rejects.toThrow();
  await expect(
    savePreview(taskId, {
      instances: [proposal.instances[0], proposal.instances[0]],
    }),
  ).rejects.toThrow("Duplicate");
  await expect(submitProposal(taskId, "a".repeat(64))).rejects.toThrow(
    "preview first",
  );
  await expect(readTask(`${taskId}-unknown`)).rejects.toBeInstanceOf(
    AnnotationRunNotFoundError,
  );
  await cancelAnnotationRun(ref);
  await expect(readTask(taskId)).rejects.toBeInstanceOf(
    AnnotationRunConflictError,
  );
});

test("twenty regions reuse frozen context across views and reconnects before finalization", async () => {
  const { ref } = await setup("remote-multiregion");
  await cancelAnnotationRun(ref);
  const source = await sharp({
    create: { width: 320, height: 16, channels: 3, background: "#aaa" },
  })
    .png()
    .toBuffer();
  ref.digest = (await storeImage(source)).digest;
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Regional annotation test",
    classes: ["ungerminated", "germinated"],
  });
  ref.modelId = model.id;
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      area: "image",
      instructions: "Box all seeds",
      coreSize: 16,
      halo: 4,
      displayScale: 1,
    },
  });
  const second = await createAnnotationRun({ ref, input: null, scope: null });
  expect(second.progress.total).toBe(20);
  const firstTask = (await nextAnnotationTask(ref)).taskId;
  const context = await readAnnotationContext(firstTask);
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      area: "image",
      instructions: "Changed future rules",
      coreSize: 32,
      halo: 4,
      displayScale: 1,
    },
  });
  let completed = 0;
  let deliveredImages = context.filter((item) => item.kind === "image").length;
  for (let status = "running"; status === "running";) {
    const next = await nextAnnotationTask(ref);
    const view = await viewAnnotationTask(next.taskId);
    expect(view.filter((item) => item.kind === "image")).toHaveLength(1);
    expect(view[0]).toMatchObject({
      kind: "description",
      value: { contextId: second.id },
    });
    expect(
      JSON.stringify(view.filter((item) => item.kind === "description")),
    ).not.toContain("Box all seeds");
    const preview = await previewAnnotationTask(next.taskId, {
      instances: [],
    });
    deliveredImages +=
      view.filter((item) => item.kind === "image").length +
      preview.panels.filter((item) => item.kind === "image").length;
    const receipt = await submitProposal(next.taskId, preview.proposalId);
    completed++;
    status = receipt.status;
    expect(receipt.status).toBe(
      completed === second.progress.total ? "succeeded" : "running",
    );
  }
  expect(completed).toBe(second.progress.total);
  expect(deliveredImages).toBe(61);
  expect(await readAnnotationContext(firstTask)).toEqual(context);
  const later = await createAnnotationRun({ ref, input: null, scope: null });
  const laterTask = (await nextAnnotationTask(ref)).taskId;
  expect(later.id).not.toBe(second.id);
  expect((await readAnnotationContext(laterTask))[0]).toMatchObject({
    kind: "description",
    value: { contextId: later.id, rules: "Changed future rules" },
  });
  await cancelAnnotationRun(ref);
});

test("a run scoped to part of the image redraws only the regions it touches and keeps the boxes of the reading it begins from elsewhere", async () => {
  const { ref } = await setup("remote-partial");
  await cancelAnnotationRun(ref);
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Partial annotation test",
    classes: ["ungerminated", "germinated"],
  });
  ref.modelId = model.id;
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      area: "image",
      instructions: "Box all seeds",
      coreSize: 16,
      halo: 4,
      displayScale: 1,
    },
  });
  const kept = {
    id: "kept",
    class: "ungerminated",
    bbox: { x: 2, y: 2, width: 4, height: 4 },
  };
  const stale = {
    id: "stale",
    class: "ungerminated",
    bbox: { x: 50, y: 50, width: 4, height: 4 },
  };
  await storeAnnotation(ref, [kept, stale], null);
  const corner = { x: 48, y: 48, width: 16, height: 16 };
  await expect(
    createAnnotationRun({ ref, input: null, scope: [corner] }),
  ).rejects.toThrow("needs the boxes to keep");
  await expect(
    createAnnotationRun({ ref, input: "proposal", scope: [corner] }),
  ).rejects.toThrow("no proposal to begin from");
  await expect(
    createAnnotationRun({
      ref,
      input: "review",
      scope: [{ ...corner, width: 32 }],
    }),
  ).rejects.toThrow("exceeds image bounds");
  const partial = await createAnnotationRun({
    ref,
    input: "review",
    scope: [corner],
  });
  expect(partial.progress.total).toBe(1);
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(stored!.definition.input).toEqual([kept, stale]);
  const next = await nextAnnotationTask(ref);
  expect(next.taskId).toBe(`${partial.id}/tile-003-003`);
  const preview = await savePreview(next.taskId, {
    instances: [
      { id: "fresh", class: "ungerminated", box_2d: [500, 500, 700, 700] },
    ],
  });
  const receipt = await submitProposal(next.taskId, preview.proposalId);
  expect(receipt.status).toBe("succeeded");
  const [done] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(
    done!.result!.document.instances.map((instance) => instance.id).sort(),
  ).toEqual([`${partial.id}/tile-003-003/fresh`, "kept"]);
  expect((await readAnnotation(ref))!.instances).toEqual([kept, stale]);
});

test("partial redraw keeps untouched boxes awaiting confirmation, replaces redrawn ones and reads seam objects once", async () => {
  const { ref } = await setup("remote-partial-notes");
  await cancelAnnotationRun(ref);
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Partial proposal notes",
    classes: ["ungerminated", "germinated"],
  });
  ref.modelId = model.id;
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      area: "image",
      instructions: "Box all seeds",
      coreSize: 16,
      halo: 4,
      displayScale: 1,
    },
  });
  const base = await createAnnotationRun({ ref, input: null, scope: null });
  for (let i = 0; i < base.progress.total; i++) {
    const { taskId } = await nextAnnotationTask(ref);
    const first = taskId.endsWith("tile-000-000");
    const neighbor = taskId.endsWith("tile-000-001");
    const corner = taskId.endsWith("tile-003-003");
    const box_2d = first
      ? [100, 600, 300, 950]
      : neighbor
        ? [100, 90, 300, 360]
        : [500, 500, 700, 700];
    const preview = await savePreview(taskId, {
      instances:
        first || neighbor || corner
          ? [
              {
                id: "seed",
                class: "ungerminated",
                box_2d,
                uncertain: first || corner,
              },
            ]
          : [],
    });
    await submitProposal(taskId, preview.proposalId);
  }
  const before = (await readAnnotationReading(ref)).proposal!;
  expect(before.uncertainIds).toHaveLength(2);
  expect(before.document.instances).toHaveLength(2);

  const partial = await createAnnotationRun({
    ref,
    input: "proposal",
    scope: [{ x: 48, y: 48, width: 16, height: 16 }],
  });
  const db = await database();
  const [frozen] = await db
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(frozen!.definition.inputUncertainIds).toEqual(before.uncertainIds);
  const { taskId } = await nextAnnotationTask(ref);
  const preview = await savePreview(taskId, { instances: [] });
  await submitProposal(taskId, preview.proposalId);
  const after = (await readAnnotationReading(ref)).proposal!;
  expect(after.document.instances).toEqual(
    before.document.instances.filter(
      (item) => !item.id.includes("tile-003-003"),
    ),
  );
  expect(after.uncertainIds).toEqual(
    before.uncertainIds.filter((id) => !id.includes("tile-003-003")),
  );
  expect(await readAnnotation(ref)).toBeNull();

  const redraw = await createAnnotationRun({
    ref,
    input: "proposal",
    scope: null,
  });
  for (let i = 0; i < redraw.progress.total; i++) {
    const next = await nextAnnotationTask(ref);
    const empty = await savePreview(next.taskId, { instances: [] });
    await submitProposal(next.taskId, empty.proposalId);
  }
  const final = (await readAnnotationReading(ref)).proposal!;
  expect(final.document.instances).toEqual([]);
  expect(final.uncertainIds).toEqual([]);
});
