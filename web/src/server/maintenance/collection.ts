import { collectImages } from "../images/public";
import { collectUnreferencedModelWeights } from "../models/public";
import { collectTrainingArtifactParts } from "../training/public";

interface CollectedBlobs {
  images: string[];
  modelWeights: string[];
  trainingArtifactParts: string[];
}

export async function collectUnreferencedBlobs(): Promise<CollectedBlobs> {
  return {
    images: await collectImages(),
    modelWeights: await collectUnreferencedModelWeights(),
    trainingArtifactParts: await collectTrainingArtifactParts(),
  };
}

export function collectionReport(collected: CollectedBlobs): string {
  return `Collected ${collected.images.length} image(s), ${collected.modelWeights.length} model weight object(s), and ${collected.trainingArtifactParts.length} training artifact part(s)`;
}
