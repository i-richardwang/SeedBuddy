import { instancesFromDetection } from "../../domain/annotation/detection";
import type { Dataset } from "../../domain/datasets/schema";
import type { Tally } from "../../domain/models/classes";
import type { ModelVersion } from "../../domain/models/schema";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import {
  addExperimentObservationImages,
  addExperimentObservationImagesToNewDataset,
  readDatasetByName,
} from "../datasets/datasets";
import { database } from "../infra/db/client";
import { datasetSnapshotImages } from "../infra/db/schema";
import { type ObservedImages, observeImages } from "./experiments";
import {
  countedInstances,
  FIXTURE_EDGE,
  imageDigest,
  resultFor,
  storeTexts,
} from "./images";
import { seedDetectionResult } from "./inference";

interface SeededDataset extends ObservedImages {
  dataset: Dataset;
}

/**
 * Creates observation images from the texts and adds them to the dataset of
 * this name, founding it on the first call.
 */
export async function observeTextsIntoDataset(
  datasetName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const observation = await observeImages(
    `${datasetName} images`,
    contents,
    version,
  );
  const existing = await readDatasetByName(datasetName);
  const { dataset } = existing
    ? await addExperimentObservationImages({
        dataset: existing.id,
        images: observation.images,
      })
    : await addExperimentObservationImagesToNewDataset({
        name: datasetName,
        images: observation.images,
      });
  return { ...observation, dataset };
}

/**
 * Uploads the texts and reviews each, ready for training. A review belongs
 * to the image and the model, so texts already reviewed by an earlier call
 * keep the review they have.
 */
export async function reviewedDataset(
  datasetName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const seeded = await observeTextsIntoDataset(datasetName, contents, version);
  for (const content of contents) {
    const ref = {
      digest: await imageDigest(content),
      modelId: seeded.version.modelId,
    };
    if (await readAnnotation(ref)) continue;
    const result = await resultFor(seeded.version, content);
    await seedDetectionResult(
      { digest: ref.digest, versionId: seeded.version.id },
      result,
      { runtimes: [result.producer.runtime] },
    );
    await storeAnnotation(ref, instancesFromDetection(result), null);
  }
  return seeded;
}

/**
 * Freezes the images into the snapshot a trained version was published from,
 * each with its split and the counts its review holds, as a training snapshot
 * would. Returns the digests in order.
 */
export async function snapshotImages(
  version: ModelVersion,
  images: { content: string; split: "train" | "val"; reviewed: Tally }[],
): Promise<string[]> {
  if (version.source.kind !== "training_run") {
    throw new Error(`${version.id} was not trained`);
  }
  const { datasetSnapshotId: snapshotId } = version.source;
  const digests = await storeTexts(images.map((image) => image.content));
  await (await database()).insert(datasetSnapshotImages).values(
    images.map((image, index) => ({
      snapshotId,
      modelId: version.modelId,
      imageId: digests[index]!,
      split: image.split,
      annotation: {
        schemaVersion: 1 as const,
        image: {
          digest: digests[index]!,
          width: FIXTURE_EDGE,
          height: FIXTURE_EDGE,
        },
        instances: countedInstances(image.reviewed),
      },
    })),
  );
  return digests;
}
