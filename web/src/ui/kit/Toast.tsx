import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleCheck, CircleX, type LucideIcon, X } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import { defaultPortalContainer } from "./floating";
import { Icon } from "./Icon";

/*
 * `<Toaster />` mounts once at the root; anywhere else calls `toast.success(...)`
 * and its siblings without React context. Base UI's toast manager only
 * dispatches: a toast shows once `<Toaster />` has mounted. Toasts stack at
 * the bottom end of the viewport.
 */

type ToastType = "success" | "error";

interface ToastOptions {
  /** Without a title the description is the whole message, in body color. */
  description: ReactNode;
  title?: ReactNode;
}

type ToastInput = ToastOptions | string;

const DURATION = 5000;
const LIMIT = 5;

const manager = BaseToast.createToastManager();

const ICONS: Record<ToastType, LucideIcon> = {
  error: CircleX,
  success: CircleCheck,
};

const ICON_COLORS: Record<ToastType, string> = {
  error: "var(--color-error)",
  success: "var(--color-success)",
};

function add(type: ToastType, input: ToastInput) {
  const options: ToastOptions =
    typeof input === "string" ? { description: input } : input;
  manager.add({
    description: options.description,
    title: options.title,
    type,
  });
}

export const toast = {
  error: (input: ToastInput) => add("error", input),
  success: (input: ToastInput) => add("success", input),
};

function CloseButton() {
  return (
    <BaseToast.Close aria-label={m.ui_close()} className="ui-toast-close">
      <X size={14} />
    </BaseToast.Close>
  );
}

function ToastItem({ item }: { item: BaseToast.Root.ToastObject }) {
  const type = item.type as ToastType;
  return (
    <BaseToast.Root
      className="ui-toast"
      swipeDirection={["down", "right"]}
      toast={item}
    >
      <BaseToast.Content className="ui-toast-content">
        <div className="ui-toast-body">
          <div className="ui-toast-icon">
            <Icon color={ICON_COLORS[type]} icon={ICONS[type]} size={18} />
          </div>
          <div className="ui-toast-main">
            {item.title ? (
              <>
                <div className="ui-toast-title-row">
                  <BaseToast.Title className="ui-toast-title">
                    {item.title}
                  </BaseToast.Title>
                  <CloseButton />
                </div>
                <BaseToast.Description className="ui-toast-description">
                  {item.description}
                </BaseToast.Description>
              </>
            ) : (
              <div className="ui-toast-title-row">
                <BaseToast.Description
                  className={cn(
                    "ui-toast-description",
                    "ui-toast-description-standalone",
                  )}
                >
                  {item.description}
                </BaseToast.Description>
                <CloseButton />
              </div>
            )}
          </div>
        </div>
      </BaseToast.Content>
    </BaseToast.Root>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((item) => <ToastItem item={item} key={item.id} />);
}

export function Toaster() {
  return (
    <BaseToast.Provider limit={LIMIT} timeout={DURATION} toastManager={manager}>
      <BaseToast.Portal container={defaultPortalContainer()}>
        <BaseToast.Viewport className="ui-toast-viewport">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
