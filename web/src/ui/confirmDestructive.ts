import { type ReactNode, useCallback } from "react";

import { m } from "../paraglide/messages";
import { type ActionSuccess, useAsyncAction } from "./hooks/useAsyncAction";
import { confirmModal } from "./kit/Modal";

/**
 * Asks before an irreversible action. The dialog stays open while the action
 * runs and after it fails, so the reader can retry or cancel; `onCancel`
 * hears every way of dismissing it. The returned function withdraws the
 * question unanswered.
 */
export function useConfirmDestructive() {
  const { run } = useAsyncAction();
  return useCallback(
    function confirmDestructive({
      title,
      content,
      confirmLabel,
      onConfirm,
      onCancel,
      onSuccess,
      invalidate,
    }: {
      title: string;
      content?: ReactNode;
      confirmLabel: string;
      onConfirm: () => void | Promise<void>;
      onCancel?: () => void;
    } & ActionSuccess<void>): () => void {
      return confirmModal({
        title,
        content,
        okText: confirmLabel,
        danger: true,
        onOk: async () => {
          const result = await run(
            async () => {
              await onConfirm();
            },
            m.action_failed({ action: confirmLabel }),
            { onSuccess, invalidate },
          );
          if (!result.ok) throw result.error;
        },
        onCancel,
      });
    },
    [run],
  );
}
