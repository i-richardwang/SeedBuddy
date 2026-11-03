import type { AttemptOwner } from "../../domain/workers/schema";
import { modelBundleSchema } from "../../domain/models/bundle";
import { database, transaction } from "../infra/db/client";
import { canonicalJson } from "../../lib/json/canonical";

import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import {
  readModelVersion,
  prepareModelUpload,
  uploadModelWeights,
  registerUploadedModel,
} from "../models/public";
import {
  readTrainingRun,
  lockTrainingRun,
  requireOwnedRunningRun,
  transitionTrainingRun,
} from "./runs";
import { readTrainingArtifactParts } from "./artifacts";
import { readDatasetSnapshot } from "./snapshots";

/** Training owns execution; the model registry owns its delivered artifact. */
export async function publishTrainingArtifact(
  runId: string,
  owner: AttemptOwner,
  bundle: unknown,
) {
  const parsed = modelBundleSchema.safeParse(bundle);
  if (!parsed.success)
    throw new TrainingArtifactValidationError(parsed.error.message);
  const document = parsed.data;
  const db = await database();
  const current = await readTrainingRun(runId, db);
  if (!current)
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  if (canonicalJson(document.training) !== canonicalJson(current.recipe))
    throw new TrainingArtifactValidationError(
      "Training artifact identity does not match the run recipe",
    );
  if (current.attempt !== owner.attempt)
    throw new TrainingRunConflictError("Training attempt was superseded");
  if (current.state.status !== "succeeded")
    await requireOwnedRunningRun(runId, current, owner, db);
  const snapshot = await readDatasetSnapshot(current.datasetSnapshotId, db);
  if (!snapshot)
    throw new TrainingRunNotFoundError("Training snapshot is missing");
  if (document.provenance.dataset.snapshotId !== snapshot.id)
    throw new TrainingArtifactValidationError(
      "Bundle does not describe this training snapshot",
    );
  if (current.state.status === "succeeded") {
    const version = await readModelVersion(current.state.modelVersionId);
    if (
      version?.artifact.kind !== "ultralytics" ||
      canonicalJson(version.artifact.weights) !==
        canonicalJson(document.weights)
    )
      throw new TrainingRunConflictError(
        "Training already published different contents",
      );
  }
  const upload = await prepareModelUpload(current.modelId, document);
  if (current.state.status !== "succeeded") {
    const weights = await readTrainingArtifactParts(
      runId,
      owner,
      document.weights,
    );
    await uploadModelWeights(upload.uploadId, weights);
  }
  return transaction(async (tx) => {
    const locked = await lockTrainingRun(runId, tx);
    if (locked.attempt !== owner.attempt)
      throw new TrainingRunConflictError("Training attempt was superseded");
    if (locked.state.status !== "succeeded")
      await requireOwnedRunningRun(runId, locked, owner, tx);
    const version = await registerUploadedModel(
      upload.uploadId,
      {
        kind: "training_run",
        trainingRunId: runId,
        trainingAttempt: owner.attempt,
        datasetSnapshotId: snapshot.id,
      },
      tx,
    );
    if (locked.state.status === "succeeded") {
      if (locked.state.modelVersionId !== version.id)
        throw new TrainingRunConflictError(
          "Training already published different contents",
        );
      return locked;
    }
    return transitionTrainingRun(
      runId,
      { status: "succeeded", modelVersionId: version.id },
      tx,
    );
  });
}
