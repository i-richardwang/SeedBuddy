import { and, eq } from "drizzle-orm";

import type { DetectionResult } from "../../domain/detection/schema";
import type { InferenceTarget } from "../../domain/inference/assignments";
import {
  DetectionConflictError,
  DetectionImageNotFoundError,
  DetectionOutcomeInvalidError,
  ProducerMismatchError,
} from "../../domain/inference/errors";
import { sameRuntimeDescriptor } from "../../domain/inference/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { supportsRuntime } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { assertDocumentImage } from "../images/public";
import type { Executor } from "../infra/db/client";
import { images, inferenceOutcomes, modelVersions } from "../infra/db/schema";
import { lockDetection } from "./lock";

function sameDocument(left: DetectionResult, right: DetectionResult): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** The classes the producing version finds, once the outcome is shown to be its own. */
async function assertProducer(
  target: InferenceTarget,
  outcome: DetectionResult,
  worker: Pick<Worker, "runtimes">,
  db: Executor,
): Promise<string[]> {
  const { producer } = outcome;
  if (producer.modelVersionId !== target.versionId) {
    throw new ProducerMismatchError(
      `Outcome was produced by ${producer.modelVersionId}, not ${target.versionId}`,
    );
  }
  const [version] = await db
    .select({
      artifact: modelVersions.artifact,
      artifactDigest: modelVersions.artifactDigest,
      classes: modelVersions.classes,
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
  return version.classes;
}

/**
 * Records the successful detection for an image/version pair exactly once.
 * Repeating an identical result is safe; a conflicting result is refused.
 */
export async function storeInferenceOutcome(
  target: InferenceTarget,
  outcome: DetectionResult,
  worker: Pick<Worker, "runtimes">,
  at: Date,
  db: Executor,
): Promise<void> {
  await lockDetection(target.digest, target.versionId, db);
  const [image] = await db
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
  const classes = await assertProducer(target, outcome, worker, db);
  assertInstanceClasses(classes, outcome.instances, "Outcome");
  const [stored] = await db
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
    return;
  }
  await db.insert(inferenceOutcomes).values({
    imageId: target.digest,
    modelVersionId: target.versionId,
    document: outcome,
    recordedAt: at,
  });
}
