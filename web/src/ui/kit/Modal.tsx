import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { m } from "../../paraglide/messages";
import { Button } from "./Button";
import { cn } from "./cn";
import {
  DialogPresenceBackdrop,
  DialogPresenceRoot,
  useDialogPresence,
} from "./dialogPresence";
import { defaultPortalContainer } from "./floating";
import { panelTransition } from "./motionToken";
import { useScrollEdges } from "./ScrollShadow";

/*
 * `Modal` unmounts its root after the exit animation (see dialogPresence.tsx).
 * To ask before an action, call `confirmModal(...)`: it needs no React context
 * and is drawn by `<ModalHost />`, mounted once at the root.
 */

const modalMotionConfig = (): MotionProps => ({
  animate: { opacity: 1, scale: 1 },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: panelTransition("modal", "exit"),
  },
  initial: { opacity: 0, scale: 0.97 },
  transition: panelTransition("modal", "enter"),
});

/** Panel widths: `default` (520) for a form in one column, `wide` (640) for a table or a form laid out in two columns. */
export type ModalWidth = "default" | "wide";

const WIDTH = {
  default: undefined,
  wide: "ui-modal-popup-inner-wide",
} as const;

type ModalProps = {
  /** Called after the exit animation. */
  afterClose?: () => void;
  /** While true, OK spins, Cancel is disabled, and Esc, the backdrop and the close button do nothing. */
  busy?: boolean;
  children?: ReactNode;
  /** False makes a backdrop click shake the panel instead of closing it. */
  dismissOnBackdrop?: boolean;
  /** Cancel, the close button, Esc and the backdrop all call it. */
  onClose: () => void;
  open: boolean;
  title: ReactNode;
  width?: ModalWidth;
} & (
  | {
      /** Draws OK as destructive. */
      danger?: boolean;
      footer?: undefined;
      /** The form in the body that OK submits; without it OK calls `onOk`. */
      formId?: string;
      okDisabled?: boolean;
      okText: ReactNode;
      onOk?: () => void;
    }
  | {
      /** The dialog's own buttons; `null` leaves the footer out. */
      footer: ReactNode;
      danger?: never;
      formId?: never;
      okDisabled?: never;
      okText?: never;
      onOk?: never;
    }
);

export function Modal({
  open,
  title,
  children,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  width = "default",
  afterClose,
  footer,
  okText,
  onOk,
  formId,
  danger,
  okDisabled,
}: ModalProps) {
  const [isDenying, setIsDenying] = useState(false);

  const footerNode =
    footer === undefined ? (
      <>
        <Button disabled={busy} onClick={onClose}>
          {m.ui_cancel()}
        </Button>
        <Button
          danger={danger}
          disabled={okDisabled}
          form={formId}
          htmlType={formId === undefined ? "button" : "submit"}
          loading={busy}
          onClick={onOk}
          type="primary"
        >
          {okText}
        </Button>
      </>
    ) : (
      footer
    );

  return (
    <DialogPresenceRoot
      onExitComplete={afterClose}
      onOpenChange={(nextOpen, details) => {
        if (!open || nextOpen) return;
        if (
          details.reason === "outside-press" &&
          (busy || !dismissOnBackdrop)
        ) {
          setIsDenying(true);
          return;
        }
        if (busy) return;
        onClose();
      }}
      open={open}
    >
      <Dialog.Portal container={defaultPortalContainer()}>
        <DialogPresenceBackdrop className="ui-modal-backdrop" />
        <ModalPopup
          className={cn(WIDTH[width], isDenying && "ui-modal-deny-animation")}
          onDenyEnd={() => setIsDenying(false)}
        >
          <div className="ui-modal-header">
            <Dialog.Title className="ui-modal-title">{title}</Dialog.Title>
            <div className="ui-modal-header-actions">
              <Dialog.Close
                aria-label={m.ui_close()}
                className="ui-modal-close"
              >
                <X size={16} />
              </Dialog.Close>
            </div>
          </div>
          {children != null && <ModalContent>{children}</ModalContent>}
          {footerNode !== null && (
            <div className="ui-modal-footer">{footerNode}</div>
          )}
        </ModalPopup>
      </Dialog.Portal>
    </DialogPresenceRoot>
  );
}

/**
 * The body scrolls between the header and the footer, which stay in place; an
 * edge with content hidden past it is marked so a hairline separates it.
 */
function ModalContent({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref, children);
  return (
    <div
      className="ui-modal-content"
      data-overflow-bottom={edges.bottom || undefined}
      data-overflow-top={edges.top || undefined}
      ref={ref}
    >
      {children}
    </div>
  );
}

/** The full-viewport popup and the panel centered in it. */
function ModalPopup({
  children,
  className,
  onDenyEnd,
}: {
  children: ReactNode;
  className?: string;
  onDenyEnd: () => void;
}) {
  const { onExitComplete, open } = useDialogPresence();
  return (
    <Dialog.Popup className="ui-modal-popup">
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <motion.div
            {...modalMotionConfig()}
            className={cn("ui-modal-popup-inner", className)}
            key="modal-popup-panel"
            onAnimationEnd={(event) => {
              if (event.animationName === "ui-modal-deny") onDenyEnd();
            }}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Dialog.Popup>
  );
}

interface ConfirmConfig {
  content?: ReactNode;
  /** Draws the OK button as destructive. */
  danger?: boolean;
  okText: ReactNode;
  /** Called when the reader cancels: Cancel, the close button, Esc or the backdrop. */
  onCancel?: () => void;
  /**
   * Returning a Promise spins the OK button and closes once it resolves; until
   * then the dialog cannot be dismissed. On rejection the dialog stays open and
   * the buttons are clickable again; the caller reports the error.
   */
  onOk: () => void | Promise<void>;
  title: ReactNode;
}

interface ConfirmEntry {
  config: ConfirmConfig;
  id: number;
  open: boolean;
}

/*
 * Closing first sets the entry's `open` to false; it leaves the list after its
 * exit animation. An entry closed before its dialog mounted has no animation to
 * wait for and leaves at once.
 */
let confirmStack: ConfirmEntry[] = [];
let confirmSeed = 0;
const mountedConfirms = new Set<number>();
const confirmListeners = new Set<() => void>();

function setConfirmStack(next: ConfirmEntry[]) {
  confirmStack = next;
  for (const listener of confirmListeners) listener();
}

const subscribeConfirms = (listener: () => void) => {
  confirmListeners.add(listener);
  return () => {
    confirmListeners.delete(listener);
  };
};

const NO_CONFIRMS: ConfirmEntry[] = [];

const closeConfirm = (id: number) =>
  setConfirmStack(
    mountedConfirms.has(id)
      ? confirmStack.map((entry) =>
          entry.id === id ? { ...entry, open: false } : entry,
        )
      : confirmStack.filter((entry) => entry.id !== id),
  );

/**
 * Asks for confirmation in a dialog with Cancel and OK. The backdrop, Esc, the
 * close button and Cancel all cancel, except while a returned Promise runs.
 * Returns a function that closes the dialog without an answer, for a question
 * that its caller can withdraw.
 */
export function confirmModal(config: ConfirmConfig): () => void {
  const id = confirmSeed++;
  setConfirmStack([...confirmStack, { config, id, open: true }]);
  return () => closeConfirm(id);
}

function ConfirmDialog({ entry }: { entry: ConfirmEntry }) {
  const { config, id, open } = entry;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mountedConfirms.add(id);
    return () => {
      mountedConfirms.delete(id);
    };
  }, [id]);
  const ok = async () => {
    try {
      const result = config.onOk();
      if (result) {
        setBusy(true);
        await result;
      }
    } catch {
      setBusy(false);
      return;
    }
    closeConfirm(id);
  };
  return (
    <Modal
      open={open}
      title={config.title}
      busy={busy}
      onClose={() => {
        closeConfirm(id);
        config.onCancel?.();
      }}
      okText={config.okText}
      danger={config.danger}
      onOk={() => void ok()}
      afterClose={() =>
        setConfirmStack(confirmStack.filter((item) => item.id !== id))
      }
    >
      {config.content}
    </Modal>
  );
}

/** Mount once at the app root. */
export function ModalHost() {
  const stack = useSyncExternalStore(
    subscribeConfirms,
    () => confirmStack,
    () => NO_CONFIRMS,
  );
  return stack.map((entry) => <ConfirmDialog entry={entry} key={entry.id} />);
}
