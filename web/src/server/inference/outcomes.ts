import { and, eq } from "drizzle-orm";

import type { DetectionResult } from "../../domain/detection/schema";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  DetectionOutcomeInvalidError,
  ProducerMismatchError,
} from "../../domain/inference/errors";
import { sameRuntimeDescriptor } from "../../domain/inference/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { type Model, supportsRuntime } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { assertDocumentImage } from "../images/public";
import type { Executor } from "../infra/db/client";
import { images, inferenceOutcomes, modelVersions } from "../infra/db/schema";
import { readModel } from "../models/public";
import { lockDetection } from "./lock";

/** One image under one model version: the pair a detection is recorded for. */
export interface DetectionTarget {
  versionId: string;
  digest: string;
}

function sameDocument(left: DetectionResult, right: DetectionResult): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function assertProducer(
  target: DetectionTarget,
  outcome: DetectionResult,
  worker: Pick<Worker, "runtimes">,
  tx: Executor,
): Promise<Model> {
  const { producer } = outcome;
  if (producer.modelVersionId !== target.versionId) {
    throw new ProducerMismatchError(
      `Outcome was produced by ${producer.modelVersionId}, not ${target.versionId}`,
    );
  }
  const [version] = await tx
    .select({
      artifact: modelVersions.artifact,
      artifactDigest: modelVersions.artifactDigest,
      modelId: modelVersions.modelId,
    })
    .from(modelVersions)
    .where(eq(modelVersions.id, target.versionId));
  if (!version) {
    throw new ProducerMismatchError(
      `Unknown model version: ${target.versionId}`,
    );
  }
  if (version.artifactDigest !== producer.artifactDigest) {
    throw new ProducerMismatchError(
      `Outcome was produced by an artifact ${target.versionId} does not have`,
    );
  }
  if (!supportsRuntime(version.artifact, producer.runtime)) {
    throw new ProducerMismatchError(
      `Runtime ${producer.runtime.adapter} cannot execute ${version.artifact.kind} artifacts`,
    );
  }
  if (
    !worker.runtimes.some((runtime) =>
      sameRuntimeDescriptor(runtime, producer.runtime),
    )
  ) {
    throw new ProducerMismatchError(
      "Outcome was produced by a runtime the worker does not advertise",
    );
  }
  const model = await readModel(version.modelId, tx);
  if (!model) {
    throw new ProducerMismatchError(`Unknown model: ${version.modelId}`);
  }
  return model;
}

/**
 * Records the successful detection for an image/version pair exactly once.
 * Repeating an identical result is safe; a conflicting result is refused.
 */
export async function storeInferenceOutcome(
  target: DetectionTarget,
  outcome: DetectionResult,
  worker: Pick<Worker, "runtimes">,
  tx: Executor,
): Promise<DetectionResult> {
  await lockDetection(target.digest, target.versionId, tx);
  const [image] = await tx
    .select({ digest: images.id, width: images.width, height: images.height })
    .from(images)
    .where(eq(images.id, target.digest));
  if (!image) {
    throw new DetectionImageNotFoundError(
      `Image ${target.digest} is not stored`,
    );
  }
  try {
    assertDocumentImage("Outcome", outcome.image, image);
  } catch (error) {
    throw new DetectionOutcomeInvalidError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const model = await assertProducer(target, outcome, worker, tx);
  try {
    assertInstanceClasses(model.classes, outcome.instances, "Outcome");
  } catch (error) {
    throw new DetectionOutcomeInvalidError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const [stored] = await tx
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
      ),
    );
  const existing = stored?.document;
  if (existing) {
    if (!sameDocument(existing, outcome)) {
      throw new DetectionConflictError(target);
    }
    return existing;
  }
  await tx.insert(inferenceOutcomes).values({
    imageId: target.digest,
    modelVersionId: target.versionId,
    document: outcome,
    recordedAt: new Date(),
  });
  return outcome;
}
