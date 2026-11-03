import { useRouter } from "@tanstack/react-router";
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
  /** Runs after the write succeeds, while busy, before reloading. */
  onSuccess?: (value: T) => void | Promise<void>;
  invalidate?: false;
}

/** One action's busy flag and a `runAction` that raises it while the work runs. */
export function useAsyncAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(
      work: () => Promise<T>,
      failure: string,
      options: ActionSuccess<T> = {},
    ) => {
      setBusy(true);
      try {
        return await runAction(async () => {
          const value = await work();
          await options.onSuccess?.(value);
          if (options.invalidate !== false) await router.invalidate();
          return value;
        }, failure);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );
  return { busy, run };
}

export type AsyncAction = ReturnType<typeof useAsyncAction>;
