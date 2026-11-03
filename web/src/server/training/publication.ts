import type { ModelBundle } from "../../domain/models/bundle";
import {
  TrainingArtifactInvalidError,
  TrainingRunConflictError,
} from "../../domain/training/errors";
import type { AttemptOwner } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { database, operationTime, transaction } from "../infra/db/client";
import {
  modelBundleVersionId,
  prepareModelUpload,
  readModelVersion,
  registerUploadedModel,
  uploadModelWeights,
} from "../models/public";
import { readTrainingArtifactParts } from "./artifacts";
import { lockTrainingRun, transitionTrainingRun } from "./runs";
import { requireOwnedRunningRun, requireTrainingRun } from "./runs-access";

/** Training owns execution; the model registry owns its delivered artifact. */
export async function completeTrainingRun(
  runId: string,
  document: ModelBundle,
  owner: AttemptOwner,
) {
  const db = await database();
  const current = await requireTrainingRun(runId, db);
  if (canonicalJson(document.training) !== canonicalJson(current.recipe))
    throw new TrainingArtifactInvalidError(
      "Training artifact identity does not match the run recipe",
    );
  if (document.provenance.dataset.snapshotId !== current.datasetSnapshotId)
    throw new TrainingArtifactInvalidError(
      "Bundle does not describe this training snapshot",
    );
  const upload = await prepareModelUpload(current.modelId, document);
  if (current.state.status !== "succeeded") {
    const weights = await readTrainingArtifactParts(
      runId,
      document.weights,
      owner,
    );
    await uploadModelWeights(upload.uploadId, weights);
  }
  return transaction(async (db) => {
    const locked = await lockTrainingRun(runId, db);
    const at = await operationTime(db);
    if (locked.state.status === "succeeded") {
      if (locked.attempt !== owner.attempt)
        throw new TrainingRunConflictError("Training attempt was superseded");
      const version = await readModelVersion(locked.state.modelVersionId, db);
      if (
        !version ||
        version.id !==
          modelBundleVersionId(locked.modelId, document, version.source)
      )
        throw new TrainingRunConflictError(
          "Training already published different contents",
        );
      return locked;
    }
    await requireOwnedRunningRun(locked, owner, db, at);
    const version = await registerUploadedModel(
      upload.uploadId,
      {
        source: {
          kind: "training_run",
          trainingRunId: runId,
          trainingAttempt: owner.attempt,
          datasetSnapshotId: current.datasetSnapshotId,
        },
      },
      at,
      db,
    );
    return transitionTrainingRun(
      runId,
      { status: "succeeded", modelVersionId: version.id },
      at,
      db,
    );
  });
}
