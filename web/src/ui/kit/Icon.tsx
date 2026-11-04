import type { LucideIcon, LucideProps } from "lucide-react";
import {
  type ComponentProps,
  type FC,
  isValidElement,
  type ReactNode,
} from "react";

import { cn } from "./cn";

export interface IconProps
  extends
    Omit<ComponentProps<"span">, "children" | "color" | "ref">,
    Pick<LucideProps, "fill" | "color"> {
  // Any component that takes lucide-style props.
  icon: LucideIcon | FC<LucideProps> | ReactNode;
  /** Pixels, or a CSS length such as `0.95em` that follows the text around it. */
  size?: number | string;
  spin?: boolean;
  strokeWidth?: number;
}

export function Icon({
  icon,
  size = "1em",
  color,
  fill = "transparent",
  className,
  spin,
  strokeWidth = 2,
  ...props
}: IconProps) {
  const Svg = icon as LucideIcon;
  return (
    <span
      className={cn("ui-icon", spin && "ui-icon-spin", className)}
      role="img"
      {...props}
    >
      {icon &&
        (isValidElement(icon) ? (
          icon
        ) : (
          <Svg
            color={color}
            fill={fill}
            height={size}
            size={size}
            strokeWidth={strokeWidth}
            width={size}
          />
        ))}
    </span>
  );
}

/** The `icon` prop of buttons: an element is used as is, a component is drawn at 14px. */
export function resolveIcon(icon: LucideIcon | ReactNode): ReactNode {
  if (icon === undefined || icon === null) return null;
  if (
    isValidElement(icon) ||
    typeof icon === "string" ||
    typeof icon === "number"
  ) {
    return icon;
  }
  return <Icon icon={icon} size={14} />;
}
