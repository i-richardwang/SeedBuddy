import { expect, test } from "bun:test";

import { assignObservationImages } from "../experiments/observation-images";
import { createObservation } from "../experiments/observations";
import { setCurrentVersion } from "../models/public";
import {
  createExperiment,
  INOCULATED,
  reading,
  unitsOf,
} from "../testing/experiments";
import {
  countedImageResult,
  countedResult,
  storeTexts,
} from "../testing/images";
import { seedDetectionResult } from "../testing/inference";
import {
  registerTrainedVersion,
  traditionalVersion,
  trainedVersion,
} from "../testing/models";
import { TEST_RUNTIME, ultralyticsWorker as worker } from "../testing/workers";
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

test("a photograph read by a version that finds fewer classes than its model names the ones left unfound", async () => {
  // The baseline calls every seed ungerminated; the model tells four states apart.
  const baseline = await traditionalVersion("exp-unfound", "baseline-v1");
  const [digest] = await storeTexts(["unfound-image"]);
  const experiment = await createExperiment({
    name: "Unfound classes",
    inoculatedOn: INOCULATED,
    treatments: [{ name: "U", replicates: 1 }],
  });
  const units = await unitsOf(experiment.id);
  const observation = await createObservation({
    experiment: experiment.id,
    observedOn: INOCULATED,
    note: "",
    ...reading(baseline),
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: [{ unit: units.get("U-1")!, digest: digest!, filename: "U1.jpg" }],
  });
  const photograph = async () =>
    (await experimentRecordsDetail(experiment.id))!.images[0]!;

  // Nothing is left unfound by a detection that has not been made.
  expect(await photograph()).toMatchObject({
    state: "pending",
    detectionUnfound: [],
  });
  await seedDetectionResult(
    { versionId: baseline.id, digest: digest! },
    await countedResult(baseline, "unfound-image", { ungerminated: 6 }),
    { runtimes: [TEST_RUNTIME] },
  );
  expect(await photograph()).toMatchObject({
    state: "analyzed",
    detectionTally: { ungerminated: 6 },
    detectionUnfound: ["germinated", "empty", "dead"],
  });

  // A version that finds every class leaves none.
  const trained = await registerTrainedVersion(baseline.modelId);
  await setCurrentVersion({ model: baseline.modelId, version: trained.id });
  await seedDetectionResult(
    { versionId: trained.id, digest: digest! },
    countedImageResult(trained, digest!, 6),
    worker,
  );
  expect(await photograph()).toMatchObject({
    state: "analyzed",
    detectionUnfound: [],
  });
});
