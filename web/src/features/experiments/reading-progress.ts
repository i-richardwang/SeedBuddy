import type {
  ExperimentFrame,
  ExperimentProgress,
} from "../../domain/experiments/read-model";
import { getExperimentProgress } from "../../functions/experiments";
import { useRefreshOnChange } from "../../ui/hooks/useRouteRefresh";

/** While photographs wait for their reading, the page asks this often how far they have come. */
const WAITING_REFRESH_MS = 5000;

/** Progress as one value, which changes whenever either figure does. */
function progressKey({ photographs, waiting }: ExperimentProgress): string {
  return `${photographs}:${waiting}`;
}

/**
 * While the experiment's photographs wait for their reading, asks how far
 * they have come and reads the page again only once that changes, so a
 * reading appears where it was waited for.
 */
export function useReadingProgress(frame: ExperimentFrame): void {
  useRefreshOnChange(
    async () => {
      const progress = await getExperimentProgress({
        data: { experiment: frame.experiment.id },
      });
      return progress ? progressKey(progress) : null;
    },
    progressKey(frame.progress),
    WAITING_REFRESH_MS,
    frame.progress.waiting > 0,
  );
}
