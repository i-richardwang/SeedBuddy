import type { AnnotationRef } from "../../domain/annotation/schema";
import {
  DEFAULT_MODEL_ANNOTATION,
  DEFAULT_MODEL_AREA,
} from "../../domain/models/schema";
import { createAnnotationRun } from "../annotation-runs/runs";
import { nextAnnotationTask, submitProposal } from "../annotation-runs/tasks";
import { previewAnnotationTask } from "../annotation-runs/views";
import { database } from "../infra/db/client";
import { requireModel, setModelSettings } from "../models/public";

/**
 * An agent's proposal for the image under the model, reached the way an
 * agent reaches one: the model says how to annotate, a run starts, and the
 * agent finds nothing in each region it is shown, so the run succeeds.
 */
export async function agentProposal(ref: AnnotationRef) {
  const { countedClasses } = await requireModel(ref.modelId, await database());
  await setModelSettings({
    model: ref.modelId,
    countedClasses,
    area: DEFAULT_MODEL_AREA,
    annotation: {
      ...DEFAULT_MODEL_ANNOTATION,
      instructions: "Box every seed.",
    },
  });
  await createAnnotationRun({ ref, input: null, scope: null });
  let status = "running";
  while (status === "running") {
    const { taskId } = await nextAnnotationTask(ref);
    const preview = await previewAnnotationTask(taskId, { instances: [] });
    status = (await submitProposal(taskId, preview.proposalId)).status;
  }
  if (status !== "succeeded") throw new Error(`The agent's run ${status}`);
}
