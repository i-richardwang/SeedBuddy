import { expect, test } from "bun:test";

import {
  cancelAnnotationRun,
  createAnnotationRun,
} from "../annotation-runs/public";
import { storeAnnotation } from "../annotations/documents";
import { addExperimentObservationImagesToNewDataset } from "../datasets/datasets";
import { createModel, setModelSettings } from "../models/public";
import { observeImagesForModel } from "../testing/experiments";
import { pendingAnnotationsDetail } from "./pending-annotations-detail";

test("an image waits once per model until someone reads it or while a run on it is in progress, which comes first", async () => {
  const annotation = {
    instructions: "Box every seed.",
    coreSize: 512,
    halo: 32,
    displayScale: 1,
  };
  const model = await createModel({
    id: "awaiting-agent-model",
    name: "Pending",
    classes: ["seed"],
    annotation,
  });
  const observed = await observeImagesForModel(
    "awaiting-agent",
    ["awaiting-agent-a", "awaiting-agent-b"],
    model.id,
  );
  await addExperimentObservationImagesToNewDataset({
    name: "awaiting-agent",
    images: observed.images,
  });
  const listed = async () =>
    (await pendingAnnotationsDetail(model.id)).images.map(
      (image) => image.ref.digest,
    );
  expect((await listed()).sort()).toEqual([...observed.digests].sort());

  await storeAnnotation(
    { digest: observed.digests[0]!, modelId: model.id },
    [],
    null,
  );
  expect(await listed()).toEqual([observed.digests[1]!]);

  const redraw = { digest: observed.digests[0]!, modelId: model.id };
  const run = await createAnnotationRun({
    ref: redraw,
    input: "review",
    scope: null,
  });
  const { images } = await pendingAnnotationsDetail(model.id);
  expect(images.map((image) => [image.ref.digest, image.progress])).toEqual([
    [observed.digests[0]!, run.progress],
    [observed.digests[1]!, null],
  ]);
  await cancelAnnotationRun(redraw);
  expect(await listed()).toEqual([observed.digests[1]!]);

  await setModelSettings({
    model: model.id,
    area: "image",
    annotation: { ...annotation, instructions: "" },
  });
  expect(await pendingAnnotationsDetail(model.id)).toEqual({
    total: 0,
    images: [],
  });
});
