import { modelBundleSchema } from "../../domain/models/bundle";
import {
  TrainingArtifactInvalidError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../domain/training/errors";
import type { AttemptOwner } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { database, operationTime, transaction } from "../infra/db/client";
import {
  prepareModelUpload,
  readModelVersion,
  registerUploadedModel,
  uploadModelWeights,
} from "../models/public";
import { readTrainingArtifactParts } from "./artifacts";
import { lockTrainingRun, transitionTrainingRun } from "./runs";
import { requireOwnedRunningRun, requireTrainingRun } from "./runs-access";
import { readDatasetSnapshot } from "./snapshots";

/** Training owns execution; the model registry owns its delivered artifact. */
export async function completeTrainingRun(
  runId: string,
  owner: AttemptOwner,
  bundle: unknown,
) {
  const parsed = modelBundleSchema.safeParse(bundle);
  if (!parsed.success)
    throw new TrainingArtifactInvalidError(parsed.error.message);
  const document = parsed.data;
  const db = await database();
  const current = await requireTrainingRun(runId, db);
  if (canonicalJson(document.training) !== canonicalJson(current.recipe))
    throw new TrainingArtifactInvalidError(
      "Training artifact identity does not match the run recipe",
    );
  const snapshot = await readDatasetSnapshot(current.datasetSnapshotId, db);
  if (!snapshot)
    throw new TrainingRunNotFoundError("Training snapshot is missing");
  if (document.provenance.dataset.snapshotId !== snapshot.id)
    throw new TrainingArtifactInvalidError(
      "Bundle does not describe this training snapshot",
    );
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
    const at = await operationTime(tx);
    if (locked.attempt !== owner.attempt)
      throw new TrainingRunConflictError("Training attempt was superseded");
    if (locked.state.status === "succeeded") {
      const version = await readModelVersion(locked.state.modelVersionId, tx);
      if (
        version?.artifact.kind !== "ultralytics" ||
        canonicalJson(version.artifact.weights) !==
          canonicalJson(document.weights)
      )
        throw new TrainingRunConflictError(
          "Training already published different contents",
        );
      return locked;
    }
    await requireOwnedRunningRun(locked, owner, tx, at);
    const version = await registerUploadedModel(
      upload.uploadId,
      {
        kind: "training_run",
        trainingRunId: runId,
        trainingAttempt: owner.attempt,
        datasetSnapshotId: snapshot.id,
      },
      at,
      tx,
    );
    return transitionTrainingRun(
      runId,
      { status: "succeeded", modelVersionId: version.id },
      tx,
      at,
    );
  });
}
