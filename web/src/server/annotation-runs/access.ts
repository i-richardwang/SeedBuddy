import { eq } from "drizzle-orm";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../domain/annotation-runs/errors";
import { database, type Executor } from "../infra/db/client";
import { annotationRuns, annotationTasks } from "../infra/db/schema";

async function findTask(taskId: string, db: Executor, lock: boolean) {
  const query = db
    .select({ run: annotationRuns, task: annotationTasks })
    .from(annotationTasks)
    .innerJoin(annotationRuns, eq(annotationRuns.id, annotationTasks.runId))
    .where(eq(annotationTasks.taskId, taskId));
  const [found] = await (lock ? query.for("update") : query);
  if (!found) throw new AnnotationRunNotFoundError("Annotation task not found");
  if (found.run.status === "cancelled")
    throw new AnnotationRunConflictError("Annotation run is not active");
  return found;
}

/**
 * A region by its opaque task identifier, with its run. A finished run still
 * answers, so a repeated submission learns it was accepted; a cancelled one
 * does not.
 */
export async function readTask(taskId: string) {
  return findTask(taskId, await database(), false);
}

/** A region with its run, both locked until the transaction ends. */
export async function lockTask(taskId: string, tx: Executor) {
  return findTask(taskId, tx, true);
}
