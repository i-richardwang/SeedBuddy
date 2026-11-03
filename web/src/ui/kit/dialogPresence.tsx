import { Dialog } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import { createContext, use, useCallback, useMemo, useState } from "react";

import { backdropTransition } from "./motionToken";

/*
 * Open state shared by Modal and Drawer. `open` is controlled; on close the
 * root stays mounted until the panel's exit animation finishes (the panel's
 * `AnimatePresence` calls `onExitComplete`), then unmounts. While the root is
 * mounted Base UI's Dialog is always open; motion plays enter and exit.
 * Backdrop and popup sit on the `--z-index-popup` step.
 */

interface DialogPresence {
  onExitComplete: () => void;
  open: boolean;
}

const DialogPresenceContext = createContext<DialogPresence>({
  onExitComplete: () => undefined,
  open: false,
});

/** Panels and backdrops read the open state and the exit callback. */
export const useDialogPresence = () => use(DialogPresenceContext);

type DialogPresenceRootProps = Pick<
  Dialog.Root.Props,
  "children" | "onOpenChange"
> & {
  /** Called after the panel has left and the root has unmounted. */
  onExitComplete?: () => void;
  open: boolean;
};

export function DialogPresenceRoot({
  open,
  children,
  onExitComplete: onExitCompleteProp,
  onOpenChange,
}: DialogPresenceRootProps) {
  const [isPresent, setIsPresent] = useState(open);
  if (open && !isPresent) setIsPresent(true);

  const onExitComplete = useCallback(() => {
    setIsPresent(false);
    onExitCompleteProp?.();
  }, [onExitCompleteProp]);

  const presence = useMemo(
    () => ({ onExitComplete, open }),
    [onExitComplete, open],
  );

  if (!isPresent) return null;

  return (
    <DialogPresenceContext value={presence}>
      <Dialog.Root onOpenChange={onOpenChange} open>
        {children}
      </Dialog.Root>
    </DialogPresenceContext>
  );
}

export function DialogPresenceBackdrop({ className }: { className: string }) {
  const { open } = useDialogPresence();
  return (
    <Dialog.Backdrop
      className={className}
      render={
        <motion.div
          animate={{ opacity: open ? 1 : 0 }}
          initial={{ opacity: 0 }}
          transition={backdropTransition()}
        />
      }
    />
  );
}
