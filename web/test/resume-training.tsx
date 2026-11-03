import assert from "node:assert/strict";

import { mock } from "bun:test";
import { act } from "react";

import { body, browser, button, render, unmount } from "./dom";

const submissions: unknown[] = [];
mock.module("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => {} }),
}));
mock.module("../src/functions/training", () => ({
  updateTrainingRun: async (value: unknown) => {
    submissions.push(value);
  },
}));
const { ResumeTrainingDialog } =
  await import("../src/features/training/ResumeTrainingDialog");
const { YOLO26N_WHOLE_RECIPE } = await import("../src/domain/training/recipes");
const { m } = await import("../src/paraglide/messages");
type Detail = import("../src/domain/training/read-model").TrainingRunDetail;
type Run = import("../src/domain/training/schema").TrainingRun;

const paused: Run = {
  schemaVersion: 1,
  id: "train-run",
  modelId: "model",
  datasetSnapshotId: "snapshot",
  createdAt: "2026-08-28T00:00:00.000Z",
  attempt: 2,
  targetWorkerId: "gpu-1",
  lastProgressAt: null,
  checkpoint: { attempt: 2, epoch: 7, workerId: "gpu-1" },
  recipe: YOLO26N_WHOLE_RECIPE,
  state: { status: "paused" },
};
/** The dialog reads the run, its training set and the workers it can go to. */
const detail = (run: Run) =>
  ({
    dataset: { id: "test" },
    run,
    workers: [{ workerId: "gpu-1", online: true }],
  }) as unknown as Detail;
const submit = () =>
  act(async () => {
    body
      .querySelector("form")!
      .dispatchEvent(
        new browser.Event("submit", { bubbles: true, cancelable: true }),
      );
  });

try {
  await render(
    <ResumeTrainingDialog
      key="paused"
      detail={detail(paused)}
      open
      onClose={() => {}}
    />,
  );
  const saved = button(m.training_resume_from_saved({ epoch: 7 }));
  assert.ok(
    saved?.hasAttribute("data-pressed"),
    "saved progress is the default",
  );
  assert.ok(
    body.textContent?.includes(
      m.training_resume_local_worker({ worker: "gpu-1" }),
    ),
  );
  await submit();
  await act(async () => {
    (button(m.training_resume_from_start()) as unknown as HTMLElement).click();
  });
  await submit();

  await render(
    <ResumeTrainingDialog
      key="failed"
      detail={detail({
        ...paused,
        checkpoint: null,
        state: { status: "failed", error: "out of memory" },
      })}
      open
      onClose={() => {}}
    />,
  );
  assert.equal(button(m.training_resume_from_start()), undefined);
  assert.ok(body.textContent?.includes(m.training_resume_no_progress()));
  await submit();

  const resume = (restart: boolean) => ({
    data: {
      dataset: "test",
      runId: "train-run",
      attempt: 2,
      control: { action: "resume", targetWorkerId: "gpu-1", restart },
    },
  });
  assert.deepEqual(submissions, [resume(false), resume(true), resume(true)]);
  console.log("resuming training behaves");
} finally {
  await unmount();
}
