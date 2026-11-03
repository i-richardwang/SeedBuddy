import { CircleCheck } from "lucide-react";
import { type ReactNode, useState } from "react";

import { m } from "../paraglide/messages";
import { Button } from "./kit/Button";
import { Flexbox } from "./kit/Flex";
import { Icon } from "./kit/Icon";
import { Modal } from "./kit/Modal";
import { Text } from "./kit/Text";

/**
 * Shows a secret the server hands out only once, such as a new key or token:
 * a success title, the values (usually `CopyableCode`s), a line saying they
 * will not be shown again, and Done across the footer. It opens while
 * `revealed` holds a value and keeps drawing that value through the exit
 * animation. Only Done, Esc or the close button dismiss it, so a stray click
 * on the backdrop cannot lose the secret.
 */
export function RevealOnceDialog<T>({
  revealed,
  onClose,
  title,
  hint,
  children,
}: {
  revealed: T | null;
  onClose: () => void;
  title: ReactNode;
  hint: ReactNode;
  children: (revealed: T) => ReactNode;
}) {
  const [shown, setShown] = useState(revealed);
  if (revealed !== null && revealed !== shown) setShown(revealed);
  if (shown === null) return null;
  return (
    <Modal
      open={revealed !== null}
      title={
        <span className="flex items-center gap-2">
          <Icon icon={CircleCheck} size={18} className="text-success" />
          {title}
        </span>
      }
      dismissOnBackdrop={false}
      onClose={onClose}
      afterClose={() => setShown(null)}
      footer={
        <Button block type="primary" onClick={onClose}>
          {m.ui_done()}
        </Button>
      }
    >
      <Flexbox gap={16}>
        {children(shown)}
        <Text size="xs" type="tertiary">
          {hint}
        </Text>
      </Flexbox>
    </Modal>
  );
}
