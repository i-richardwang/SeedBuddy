import type { ModelBundle } from "../../domain/models/bundle";
import {
  TrainingArtifactInvalidError,
  TrainingRunConflictError,
} from "../../domain/training/errors";
import type { TrainingRun } from "../../domain/training/schema";
import type { AttemptOwner } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import {
  database,
  type Executor,
  operationTime,
  transaction,
} from "../infra/db/client";
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

/** Completed deliveries are read-only retries, identified by attempt and full bundle. */
async function completedPublication(
  run: TrainingRun,
  document: ModelBundle,
  owner: AttemptOwner,
  db: Executor,
): Promise<TrainingRun | null> {
  if (run.state.status !== "succeeded") return null;
  if (run.attempt !== owner.attempt)
    throw new TrainingRunConflictError("Training attempt was superseded");
  const version = await readModelVersion(run.state.modelVersionId, db);
  if (
    !version ||
    version.id !== modelBundleVersionId(run.modelId, document, version.source)
  )
    throw new TrainingRunConflictError(
      "Training already published different contents",
    );
  return run;
}

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
  const completed = await completedPublication(current, document, owner, db);
  if (completed) return completed;
  // Admit the execution before any storage work. Control remains free to revoke
  // it during upload; the locked check below fences publication in that case.
  await requireOwnedRunningRun(current, owner, db);
  const weights = await readTrainingArtifactParts(
    runId,
    document.weights,
    owner,
  );
  const upload = await prepareModelUpload(current.modelId, document);
  await uploadModelWeights(upload.uploadId, weights);
  return transaction(async (db) => {
    const locked = await lockTrainingRun(runId, db);
    const at = await operationTime(db);
    const completed = await completedPublication(locked, document, owner, db);
    if (completed) return completed;
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
