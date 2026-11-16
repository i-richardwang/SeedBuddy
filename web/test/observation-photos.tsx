import assert from "node:assert/strict";

import { mock } from "bun:test";
import { act } from "react";

import { observation } from "../src/domain/experiments/testing";
import {
  DEFAULT_MODEL_ANNOTATION,
  type Model,
} from "../src/domain/models/schema";
import type { PhotoBatchDetail } from "../src/domain/photos/read-model";
import { body, browser, button, press, render, unmount, waitFor } from "./dom";

mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
}));
const batch = { id: "batch", name: "Batch", createdAt: "2026-09-01T00:00:00Z" };
let loading = Promise.withResolvers<PhotoBatchDetail>();
let checking = Promise.withResolvers<[]>();
const writes: unknown[] = [];
let batchRequests = 0;
mock.module("../src/functions/photos", () => ({
  getPhotoBatchDetail: () => {
    batchRequests++;
    return loading.promise;
  },
  getPhotoBatches: async () => [],
}));
mock.module("../src/functions/experiments", () => ({
  getPlacedPhotos: () => checking.promise,
  getPhotoSlots: async () => null,
  updateObservationImages: async (request: unknown) => {
    writes.push(request);
  },
  createObservation: async (request: unknown) => {
    writes.push(request);
  },
}));
const { AddPhotosDialog } =
  await import("../src/features/experiments/AddPhotosDialog");
const { RecordObservationDialog } =
  await import("../src/features/experiments/RecordObservationDialog");
const { m } = await import("../src/paraglide/messages");
const placing = {
  slots: { units: [{ id: "unit", code: "A1", leftOn: null }], taken: [] },
  batches: [{ ...batch, photoCount: 1 }],
};
const models: Model[] = [
  {
    schemaVersion: 1,
    task: "object_detection",
    annotation: DEFAULT_MODEL_ANNOTATION,
    id: "seeds",
    name: "Seeds",
    classes: ["seed"],
    countedClasses: ["seed"],
    area: "image",
  },
];

for (const kind of ["record", "add"] as const) {
  loading = Promise.withResolvers<PhotoBatchDetail>();
  checking = Promise.withResolvers<[]>();
  batchRequests = 0;
  const baseline = writes.length;
  await render(
    kind === "add" ? (
      <AddPhotosDialog
        experiment="experiment"
        observation={observation(1)}
        placing={placing}
        open
        onClose={() => {}}
      />
    ) : (
      <RecordObservationDialog
        experiment="experiment"
        inoculatedOn="2026-09-01"
        models={models}
        observations={[]}
        placing={placing}
        open
        onClose={() => {}}
      />
    ),
  );
  await press(button(m.observation_photos_from_batch()));
  await press(
    await waitFor(
      () => body.querySelector('[role="menuitem"]'),
      "batch menu opens",
    ),
  );
  const form = body.querySelector("form")!;
  const submit = () =>
    act(async () => {
      form.dispatchEvent(
        new browser.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  const disabled = () =>
    body.querySelector(`button[form="${form.id}"]`)?.hasAttribute("disabled");
  assert.equal(disabled(), true);
  await act(async () => {
    button(m.observation_photos_from_batch())!.dispatchEvent(
      new browser.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
  assert.equal(body.querySelector('[role="menuitem"]'), null);
  assert.equal(batchRequests, 1);
  await submit();
  assert.equal(writes.length, baseline);
  await act(async () =>
    loading.resolve({
      batch,
      photos: [
        {
          digest: "a".repeat(64),
          filename: "A1.jpg",
          width: 100,
          height: 80,
          bytes: 100,
        },
      ],
    }),
  );
  assert.equal(disabled(), true);
  await submit();
  assert.equal(writes.length, baseline);
  await act(async () => checking.resolve([]));
  assert.equal(disabled(), false);
  await submit();
  assert.equal(writes.length, baseline + 1);
  assert.deepEqual(
    (writes.at(-1) as { data: { images: unknown[] } }).data.images,
    [{ unit: "unit", digest: "a".repeat(64), filename: "A1.jpg" }],
  );
  await render(null);
}
await unmount();
console.log("batch submission is gated");
