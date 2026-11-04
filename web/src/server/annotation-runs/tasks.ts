import { and, asc, eq, isNull } from "drizzle-orm";

import type { AnnotationRef } from "../../domain/annotation/schema";
import { AnnotationRunConflictError } from "../../domain/annotation-runs/errors";
import { collectRegions } from "../../domain/annotation-runs/results";
import { prepareProposal } from "../../domain/annotation-runs/tasks";
import {
  database,
  operationTime,
  single,
  transaction,
} from "../infra/db/client";
import {
  annotationPreviews,
  annotationRuns,
  annotationTasks,
} from "../infra/db/schema";
import { documentDigest } from "../infra/digest";
import { lockAnnotationTask, readTask } from "./access";
import { inProgress } from "./runs";

const conflict = (message: string): never => {
  throw new AnnotationRunConflictError(message);
};
const acceptance = (
  taskId: string,
  run: typeof annotationRuns.$inferSelect,
) => ({
  taskId,
  accepted: true,
  status: run.status,
  completed: run.completed,
  total: run.total,
});

/**
 * The first region of the image's run still waiting for an answer. It stays
 * the same until it is accepted, so any agent, in any conversation, continues
 * where the last one stopped.
 */
export async function nextAnnotationTask(ref: AnnotationRef) {
  const [next] = await (
    await database()
  )
    .select({
      taskId: annotationTasks.taskId,
      completed: annotationRuns.completed,
      total: annotationRuns.total,
    })
    .from(annotationRuns)
    .innerJoin(
      annotationTasks,
      and(
        eq(annotationTasks.runId, annotationRuns.id),
        isNull(annotationTasks.response),
      ),
    )
    .where(inProgress(ref))
    .orderBy(asc(annotationTasks.taskId))
    .limit(1);
  return next ?? conflict("No AI annotation run is in progress for this image");
}

export async function savePreview(taskId: string, value: unknown) {
  const { run, task } = await readTask(taskId);
  if (task.response) return conflict("Region has already been accepted");
  const { response, content } = prepareProposal(
    value,
    task.region,
    run.definition,
  );
  const proposalId = documentDigest({ taskId, response });
  await (
    await database()
  )
    .insert(annotationPreviews)
    .values({ runId: run.id, taskId, proposalId, response })
    .onConflictDoNothing();
  return { run, task, content, proposalId };
}

export async function submitProposal(taskId: string, proposalId: string) {
  return transaction(async (db) => {
    const { run, task } = await lockAnnotationTask(taskId, db);
    const runId = run.id;
    if (task.response) {
      if (task.acceptedProposalId !== proposalId)
        return conflict("Region already accepted a different proposal");
      return acceptance(taskId, run);
    }
    const [preview] = await db
      .select()
      .from(annotationPreviews)
      .where(
        and(
          eq(annotationPreviews.runId, runId),
          eq(annotationPreviews.taskId, taskId),
          eq(annotationPreviews.proposalId, proposalId),
        ),
      );
    if (!preview)
      return conflict("Unknown proposal for this region; preview first");
    await db
      .update(annotationTasks)
      .set({ response: preview.response, acceptedProposalId: proposalId })
      .where(eq(annotationTasks.taskId, taskId));
    const completed = run.completed + 1;
    const succeeded = completed === run.total;
    const answered = succeeded
      ? (
          await db
            .select()
            .from(annotationTasks)
            .where(eq(annotationTasks.runId, runId))
            .orderBy(asc(annotationTasks.taskId))
        ).flatMap(({ response, ...task }) =>
          response ? [{ ...task, response }] : [],
        )
      : [];
    const updated = single(
      await db
        .update(annotationRuns)
        .set({
          completed,
          status: succeeded ? "succeeded" : "running",
          result: succeeded ? collectRegions(run.definition, answered) : null,
          updatedAt: await operationTime(db),
        })
        .where(eq(annotationRuns.id, runId))
        .returning(),
      "annotationRuns",
    );
    return acceptance(taskId, updated);
  });
}
