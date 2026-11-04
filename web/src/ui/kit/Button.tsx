import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import { animate, press } from "motion";
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

import { cn } from "./cn";
import { resolveIcon } from "./Icon";
import { springTransition } from "./motionToken";

/*
 * A link is made with `render` (a router `<Link>` or an `<a>`), not with
 * `href`, so in-app navigation goes through the router. With `render`, the
 * native `disabled` and `type` are left off and `aria-disabled` blocks clicks.
 * Pressing scales the element with a spring, whatever element `render` gives.
 */

type ButtonType = "default" | "primary" | "dashed" | "text";
type ButtonSize = "small" | "middle" | "large";

export interface ButtonProps extends Omit<
  useRender.ComponentProps<"button">,
  "type"
> {
  block?: boolean;
  /** Primary only: the error color for a destructive action. */
  danger?: boolean;
  htmlType?: "button" | "submit" | "reset";
  icon?: LucideIcon | ReactNode;
  iconPosition?: "start" | "end";
  loading?: boolean;
  size?: ButtonSize;
  type?: ButtonType;
}

const SIZE = {
  small: "ui-button-size-small",
  middle: "ui-button-size-middle",
  large: "ui-button-size-large",
} as const;

const ICON_ONLY = {
  small: "ui-button-icon-only-small",
  middle: "ui-button-icon-only-middle",
  large: "ui-button-icon-only-large",
} as const;

const TAP = { scale: 0.98 };
const TAP_SPRING = { damping: 26, mass: 0.6, stiffness: 600 };

function usePressScale(enabled: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    return press(element, (target) => {
      animate(target, TAP, springTransition(TAP_SPRING));
      return () => animate(target, { scale: 1 }, springTransition(TAP_SPRING));
    });
  }, [enabled]);
  return ref;
}

const VARIANT = {
  dashed: "ui-button-variant-dashed",
  default: "ui-button-variant-default",
  primary: "ui-button-variant-primary",
  text: "ui-button-variant-text",
} as const;

export function Button({
  block,
  children,
  className,
  danger = false,
  disabled,
  htmlType = "button",
  icon,
  iconPosition = "start",
  loading,
  onClick,
  ref,
  render,
  size = "middle",
  type = "default",
  ...props
}: ButtonProps) {
  const interactionDisabled = Boolean(disabled || loading);
  const pressRef = usePressScale(!interactionDisabled);

  const hasChildren =
    children !== undefined &&
    children !== null &&
    children !== false &&
    children !== "";
  const iconOnly = !hasChildren && Boolean(loading || icon);

  const defaultProps = {
    className: cn(
      "ui-button",
      SIZE[size],
      type === "primary" && danger ? "ui-button-danger-solid" : VARIANT[type],
      block && "ui-button-block",
      iconPosition === "end" && "ui-button-icon-end",
      iconOnly && ICON_ONLY[size],
      className,
    ),
    children: (
      <>
        <span
          aria-hidden={!loading}
          className={cn(
            "ui-button-icon-box ui-button-spinner-slot",
            loading && "ui-button-spinner-slot-show",
            iconPosition === "end" && "ui-button-spinner-slot-end",
          )}
        >
          <span className="ui-button-spinner" />
        </span>
        {icon && !loading ? (
          <span className="ui-button-icon-box">{resolveIcon(icon)}</span>
        ) : null}
        {children}
      </>
    ),
    disabled: render ? undefined : disabled,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (interactionDisabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    },
    type: render ? undefined : htmlType,
  };

  return useRender({
    defaultTagName: "button",
    // Busy and disabled state belong to the component, so they come after the caller's props.
    props: mergeProps<"button">(defaultProps, props, {
      "aria-busy": loading || undefined,
      "aria-disabled": interactionDisabled || undefined,
    }),
    ref: ref ? [pressRef, ref] : pressRef,
    render,
  });
}

/** Popup triggers recognize a native `<button>` by this name (see `nativeButton.ts`). */
Button.displayName = "Button";
