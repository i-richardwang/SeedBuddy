import { type ReactNode, useState } from "react";

import { Modal, type ModalWidth } from "./kit/Modal";

type FooterProps =
  | {
      /** The form in the body that the footer's OK button submits. */
      formId: string;
      okText: ReactNode;
      danger?: boolean;
      okDisabled?: boolean;
    }
  | {
      /** Without a form to submit there is no footer; the body starts its own work, such as on a dropped file. */
      formId?: undefined;
      okText?: undefined;
      danger?: undefined;
      okDisabled?: undefined;
    };

/**
 * A dialog that collects input. With `formId`, the footer's OK button submits
 * that form. While `busy` the OK button spins and Cancel, Esc and the backdrop
 * do nothing. The body unmounts after the exit animation, so a form rendered
 * inside starts fresh on every opening. When the footer reads state of its own
 * (an upload list, a draft), the dialog renders inside a `DialogSession`
 * instead.
 */
export function FormDialog({
  open,
  onClose,
  title,
  busy,
  width,
  afterClose,
  children,
  ...footer
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  busy: boolean;
  width?: ModalWidth;
  /** Called after the exit animation; `DialogSession` passes it. */
  afterClose?: () => void;
  children: ReactNode;
} & FooterProps) {
  const dialog = { open, onClose, title, busy, width, afterClose, children };
  return footer.formId === undefined ? (
    <Modal {...dialog} footer={null} />
  ) : (
    <Modal {...dialog} {...footer} />
  );
}

/**
 * Mounts a dialog together with the state it owns, from an opening until its
 * exit animation has played, so every opening starts fresh. `children` renders
 * the dialog and hands it `afterClose`.
 */
export function DialogSession({
  open,
  children,
}: {
  open: boolean;
  children: (afterClose: () => void) => ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted ? children(() => setMounted(false)) : null;
}
