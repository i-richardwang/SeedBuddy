import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";
import { Tooltip, type TooltipProps } from "./Tooltip";

/*
 * A borderless square Button with a tertiary glyph color. `small` and
 * `middle` are Button's sizes, 24 and 32, with glyphs 14 and 16; `header`,
 * 28 with glyph 16, sits in the shell's top bar; `bar`, 36 with glyph 20,
 * stands alone in floating toolbars. A `title` wraps it in a tooltip.
 * `pressed` makes it a toggle, on or off under one name: it sets
 * `aria-pressed` and draws the pressed state. Without it the icon is a
 * command.
 */

type ActionIconSize = "small" | "middle" | "header" | "bar";

export interface ActionIconProps extends Omit<
  ButtonProps,
  "children" | "icon" | "size" | "type" | "title" | "danger" | "aria-pressed"
> {
  icon: IconProps["icon"];
  pressed?: boolean;
  size?: ActionIconSize;
  title?: TooltipProps["title"];
  tooltipProps?: Omit<TooltipProps, "children" | "title">;
}

const SIZE = {
  small: { button: "small", className: "ui-action-icon-small", glyph: 14 },
  middle: { button: "middle", className: undefined, glyph: 16 },
  header: { button: "middle", className: "ui-action-icon-header", glyph: 16 },
  bar: { button: "middle", className: "ui-action-icon-bar", glyph: 20 },
} as const;

export function ActionIcon({
  className,
  disabled,
  icon,
  pressed,
  size = "bar",
  title,
  tooltipProps,
  ...props
}: ActionIconProps) {
  const preset = SIZE[size];
  // The tooltip does not name its trigger, so a string title names the button when no aria-label is given.
  const ariaLabel =
    props["aria-label"] ?? (typeof title === "string" ? title : undefined);
  const button = (
    <Button
      {...props}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={cn("ui-action-icon", preset.className, className)}
      disabled={disabled}
      htmlType="button"
      icon={
        <Icon
          icon={icon}
          size={preset.glyph}
          className="ui-action-icon-glyph"
        />
      }
      size={preset.button}
      type="text"
    />
  );
  if (!title) return button;
  return (
    <Tooltip title={title} {...tooltipProps}>
      {button}
    </Tooltip>
  );
}

/** Popup triggers recognize a native `<button>` by this name (see `nativeButton.ts`). */
ActionIcon.displayName = "ActionIcon";
