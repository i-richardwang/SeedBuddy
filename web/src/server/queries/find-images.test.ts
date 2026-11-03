import { expect, test } from "bun:test";

import { addExperimentObservationImagesToNewDataset } from "../datasets/datasets";
import { createObservation } from "../experiments/observations";
import { assignObservationImages } from "../experiments/public";
import { createModel } from "../models/public";
import { experimentGridDetail } from "../queries/public";
import { observeImagesForModel } from "../testing/experiments";
import { storeTexts } from "../testing/images";
import { findImages } from "./find-images";

test("a person's filename or page link finds the image, once per model, with every place it is seen", async () => {
  const model = await createModel({
    id: "find-image-model",
    name: "Find",
    classes: ["seed"],
  });
  const observed = await observeImagesForModel(
    "find-images",
    ["find-image-a", "find-image-b"],
    model.id,
  );
  const { experiment } = observed;
  const grid = (await experimentGridDetail(experiment.id))!;
  const unit = grid.units.find((item) => item.code === "Test-1")!.id;
  const later = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
    modelId: model.id,
  });
  const [laterDigest] = await storeTexts(["find-image-c"]);
  await assignObservationImages({
    experiment: experiment.id,
    observation: later.id,
    images: [{ unit, digest: laterDigest!, filename: "FIND-IMAGE-C.JPG" }],
  });
  const { dataset } = await addExperimentObservationImagesToNewDataset({
    name: "find-image-set",
    images: [observed.images[0]!],
  });
  const [first] = observed.digests;
  const ref = (digest: string) => ({ digest, modelId: model.id });

  expect(await findImages("FIND-IMAGE-A")).toEqual([
    {
      ref: ref(first!),
      filename: "find-image-a.jpg",
      places: [
        { experiment: "find-images", unit: "Test-1", observedOn: "2026-08-08" },
        { dataset: "find-image-set" },
      ],
    },
  ]);
  const page = `http://localhost:3000/experiments/${experiment.id}/${unit}`;
  const digests = async (image: string) =>
    (await findImages(image)).map((found) => found.ref.digest);
  expect(await digests(page)).toEqual([laterDigest!]);
  expect(
    await digests(`${page}?observation=${observed.observation.id}`),
  ).toEqual([first!]);
  expect(await findImages(`/datasets/${dataset.id}/${first}`)).toEqual([
    {
      ref: ref(first!),
      filename: "find-image-a.jpg",
      places: [{ dataset: "find-image-set" }],
    },
  ]);
  expect(await findImages("find-images")).toEqual([]);
});
