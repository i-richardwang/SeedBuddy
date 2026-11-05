import { useAsyncAction } from "./useAsyncAction";
import { useDialog } from "./useDialog";

/**
 * Dialogs that open with what they need, read only when one is asked for:
 * `show` reads, reports a failure as an error toast titled `failure`, and
 * opens the dialog named once the read succeeds. `Reads` names each dialog
 * and what it reads; what was read stays after `close`, as `useDialog` keeps
 * it.
 */
export function useLoadedDialog<Reads extends Record<string, unknown>>() {
  const action = useAsyncAction();
  const { show, ...dialog } = useDialog<Reads>();
  return {
    ...dialog,
    /** Whether a read is under way. */
    loading: action.busy,
    show: <Key extends keyof Reads>(
      key: Key,
      load: () => Promise<Reads[Key]>,
      failure: string,
    ) =>
      void action.run(load, failure, {
        invalidate: false,
        onSuccess: (value) => show(key, value),
      }),
  };
}
