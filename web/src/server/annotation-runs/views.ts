import { readImageOverview, readImageRegion } from "../images/public";
import { readTask } from "./access";
import { renderContext, renderTask } from "./rendering";
import { savePreview } from "./tasks";
export async function readAnnotationContext(taskId: string) {
  const { run } = await readTask(taskId);
  return renderContext(
    run.id,
    run.definition,
    await readImageOverview(
      run.definition.image,
      run.definition.config,
      run.definition.scope,
      run.definition.coverage,
    ),
  );
}
export async function viewAnnotationTask(taskId: string) {
  const { run, task } = await readTask(taskId);
  return renderTask(
    run.id,
    run.definition,
    task.region,
    await readImageRegion(
      run.definition.image,
      run.definition.config,
      task.region.id,
      run.definition.scope,
      run.definition.coverage,
    ),
  );
}
export async function previewAnnotationTask(taskId: string, proposal: unknown) {
  const { run, task, content, proposalId } = await savePreview(
    taskId,
    proposal,
  );
  return {
    proposalId,
    panels: await renderTask(
      run.id,
      run.definition,
      task.region,
      await readImageRegion(
        run.definition.image,
        run.definition.config,
        task.region.id,
        run.definition.scope,
        run.definition.coverage,
      ),
      { content, proposalId },
    ),
  };
}
