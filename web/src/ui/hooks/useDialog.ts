import { useState } from "react";

/** One of the dialogs, with what it was opened with. */
export type ShownDialog<Values> = {
  [Key in keyof Values]: { key: Key; value: Values[Key] };
}[keyof Values];

/**
 * Dialogs opened with what they show: `show` opens the one named with its
 * value, which stays after `close`, so a closing dialog keeps its content
 * while it animates out. `Values` names each dialog and what it is given.
 */
export function useDialog<Values extends Record<string, unknown>>() {
  const [shown, setShown] = useState<{
    open: boolean;
    last: ShownDialog<Values> | null;
  }>({ open: false, last: null });
  return {
    /** The dialog open now, or the last one, with what it was given. */
    last: shown.last,
    /** Whether the last dialog is open. */
    open: shown.open,
    show: <Key extends keyof Values>(key: Key, value: Values[Key]) =>
      setShown({ open: true, last: { key, value } as ShownDialog<Values> }),
    close: () => setShown((previous) => ({ ...previous, open: false })),
  };
}
