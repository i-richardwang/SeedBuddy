import type { ComponentProps } from "react";

import { cn } from "./cn";

/** A filled label; `color` tints it with a status color. */

type TagSize = "small" | "middle";
type TagStatusColor = "warning" | "info";

const COLOR = {
  warning: "ui-tag-warning",
  info: "ui-tag-info",
} satisfies Record<TagStatusColor, string>;

interface TagProps extends Omit<ComponentProps<"span">, "color"> {
  color?: TagStatusColor;
  size?: TagSize;
}

const SIZE = {
  middle: "ui-tag-middle",
  small: "ui-tag-small",
} as const;

export function Tag({
  children,
  className,
  color,
  size = "middle",
  ...props
}: TagProps) {
  return (
    <span
      className={cn("ui-tag", SIZE[size], color && COLOR[color], className)}
      {...props}
    >
      {children}
    </span>
  );
}
