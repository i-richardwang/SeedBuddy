import { expect, test } from "bun:test";

import { observedTwice } from "../testing/experiments";
import { imageDigest } from "../testing/images";
import { findPlacedPhotos } from "./find-placed-photos";

test("names only the photographs asked about that the experiment holds", async () => {
  const { experiment } = await observedTwice("Placed");
  const held = await imageDigest("Placed-a2");
  const free = await imageDigest("Placed-elsewhere");
  expect(await findPlacedPhotos(experiment.id, [held, free])).toEqual([
    {
      digest: held,
      filename: "A-2.jpg",
      unit: "A-2",
      observedOn: "2026-08-08",
    },
  ]);
  expect(await findPlacedPhotos(experiment.id, [])).toEqual([]);
});
