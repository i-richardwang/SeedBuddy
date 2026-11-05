import { expect, test } from "bun:test";

import { ImageNotFoundError } from "../../domain/images/errors";
import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import { experimentRecordsDetail } from "../queries/experiment-records-detail";
import {
  createExperiment,
  INOCULATED,
  reading,
  unitSeries,
  unitsOf,
} from "../testing/experiments";
import { storeTexts } from "../testing/images";
import { trainedVersion } from "../testing/models";
import { clearImageUnclear, markImageUnclear } from "./unclear";

test("a photograph found unclear is marked on its image, wherever it is shown", async () => {
  const version = await trainedVersion("exp-unclear");
  const experiment = await createExperiment({
    name: "Unclear",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "A", replicates: 2 }],
  });
  // Unclear photographs do not count unless the experiment says so.
  expect(experiment.countsUnclear).toBe(false);
  const units = await unitsOf(experiment.id);
  const day7 = await createObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
    ...reading(version),
  });
  const [fogged, clear] = await storeTexts(["u-a1", "u-a2"]);
  // A photograph known to be unclear is marked as it is placed.
  await assignObservationImages({
    experiment: experiment.id,
    observation: day7.id,
    images: [
      {
        unit: units.get("A-1")!,
        digest: fogged!,
        filename: "fogged.jpg",
        unclear: true,
      },
      { unit: units.get("A-2")!, digest: clear!, filename: "clear.jpg" },
    ],
  });
  const cellOf = async (id: string, unit: string) =>
    (await experimentRecordsDetail(id))!.images.find(
      (image) => image.unit === unit,
    )!;
  expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(true);
  expect((await cellOf(experiment.id, units.get("A-2")!)).unclear).toBe(false);
  const page = await unitSeries({
    experiment: experiment.id,
    unit: units.get("A-1")!,
  });
  expect(page?.shown?.unclear).toBe(true);
  expect(page?.observations[0]?.image?.unclear).toBe(true);

  // Marking again is harmless; the image is not read again.
  expect(await markImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    marked: false,
  });

  // The mark is the image's: another experiment showing it shows the mark.
  const other = await createExperiment({
    name: "Unclear elsewhere",
    inoculatedOn: INOCULATED,
    countsUnclear: true,
  });
  expect(other.countsUnclear).toBe(true);
  const otherUnits = await unitsOf(other.id);
  const otherDay = await createObservation({
    experiment: other.id,
    observedOn: "2026-08-09",
    note: "",
    ...reading(version),
  });
  await assignObservationImages({
    experiment: other.id,
    observation: otherDay.id,
    images: [
      { unit: otherUnits.get("A-1")!, digest: fogged!, filename: "f.jpg" },
    ],
  });
  expect((await cellOf(other.id, otherUnits.get("A-1")!)).unclear).toBe(true);

  // Clearing makes it clear again, and clearing twice is harmless.
  expect(await clearImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    cleared: true,
  });
  expect(await clearImageUnclear({ digest: fogged! })).toEqual({
    digest: fogged,
    cleared: false,
  });
  expect((await cellOf(experiment.id, units.get("A-1")!)).unclear).toBe(false);

  const unknown = "f".repeat(64);
  await expect(markImageUnclear({ digest: unknown })).rejects.toThrow(
    ImageNotFoundError,
  );
  await expect(clearImageUnclear({ digest: unknown })).rejects.toThrow(
    ImageNotFoundError,
  );
});
