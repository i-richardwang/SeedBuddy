import { expect, test } from "bun:test";

import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import {
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import { countedImageResult, storeTexts } from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import { trainedVersion } from "../testing/models";
import { ultralyticsWorker as worker } from "../testing/workers";
import { experimentRecordsDetail } from "./experiment-records-detail";

test("two experiments analyzing one image with one version share one inference", async () => {
  const version = await trainedVersion("exp-shared");
  const [digest] = await storeTexts(["shared-image"]);
  const experimentIds: string[] = [];
  for (const name of ["Shared demand A", "Shared demand B"]) {
    const experiment = await createExperiment({
      name,
      inoculatedOn: INOCULATED,
      treatments: [{ name: "S", replicates: 1 }],
    });
    const units = await unitsOf(experiment.id);
    const observation = await createObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
      ...reading(version),
    });
    await assignObservationImages({
      experiment: experiment.id,
      observation: observation.id,
      images: [
        {
          unit: units.get("S-1")!,
          digest: digest!,
          filename: "S1.jpg",
        },
      ],
    });
    experimentIds.push(experiment.id);
  }

  const states = async () =>
    Promise.all(
      experimentIds.map(
        async (id) => (await experimentRecordsDetail(id))?.images[0]?.state,
      ),
    );
  expect(await states()).toEqual(["pending", "pending"]);

  await seedDetectionResult(
    { versionId: version.id, digest: digest! },
    countedImageResult(version, digest!, 1),
    worker,
  );
  expect(await states()).toEqual(["analyzed", "analyzed"]);
});
