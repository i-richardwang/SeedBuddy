import { useCallback, useState } from "react";

import { errorMessage } from "../errors";
import { toast } from "../kit/Toast";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs `work` and reports a failure as an error toast titled `failure`; the
 * result says whether the work succeeded. An aborted `signal` suppresses
 * the failure toast; it does not cancel the work or stop awaiting its result.
 */
export async function runAction<T>(
  work: () => Promise<T>,
  failure: string,
  signal?: AbortSignal,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (!signal?.aborted) {
      toast.error({ title: failure, description: errorMessage(error) });
    }
    return { ok: false, error };
  }
}

export interface ActionSuccess<T> {
  /** Runs after the write succeeds and the busy flag clears, before reloading. */
  onSuccess?: (value: T) => void | Promise<void>;
  invalidate?: () => Promise<void>;
}

/** One action's busy flag and a `runAction` that raises it while the work runs. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(
      work: () => Promise<T>,
      failure: string,
      options: ActionSuccess<T> = {},
    ) => {
      setBusy(true);
      let result: ActionResult<T>;
      try {
        result = await runAction(work, failure);
      } finally {
        setBusy(false);
      }
      if (result.ok) {
        await options.onSuccess?.(result.value);
        await options.invalidate?.();
      }
      return result;
    },
    [],
  );
  return { busy, run };
}

export type AsyncAction = ReturnType<typeof useAsyncAction>;
