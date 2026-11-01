import { collectUnreferencedModelWeights } from "../models/public";
import { collectImages } from "../images/public";
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
