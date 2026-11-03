import type { HTMLAttributes } from "react";

import { cn } from "./cn";

/*
 * Loading placeholders. `Skeleton` is one block and the other shapes are
 * built from it. Each `Skeleton.Text` row takes exactly one line box of text
 * at a type-scale `size`, read from that step's font size and line height:
 * a quarter of the leading above and below, the block filling the rest, so
 * nothing shifts when the real text arrives. `Skeleton.Inline` stands in
 * for a value inside a line of text. `Skeleton.Button` has the size of a
 * middle Button, or of a `small` or an `icon`-only one. A block fills its
 * container's width and is 1em tall unless its props or classes size it.
 */

type Length = number | string;

interface SkeletonProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "style"
> {
  height?: Length;
  /** The corner radius, where the block stands for a shape that is not a rounded bar. */
  radius?: Length;
  width?: Length;
}

function SkeletonRoot({
  width,
  height,
  radius,
  className,
  ...rest
}: SkeletonProps) {
  return (
    <div
      className={cn("ui-skeleton", className)}
      style={{ borderRadius: radius, height, width }}
      {...rest}
    />
  );
}

/** A bone sitting in a line of text, as wide as the value it stands for. */
function SkeletonInline({ width }: { width: Length }) {
  return (
    <span
      aria-hidden
      className="ui-skeleton ui-skeleton-inline"
      style={{ width }}
    />
  );
}

const LINE_SIZE = {
  xs: "ui-skeleton-line-xs",
  sm: "ui-skeleton-line-sm",
  base: "ui-skeleton-line-base",
  lg: "ui-skeleton-line-lg",
} as const;

function SkeletonText({
  rows = 1,
  size = "base",
  width,
}: {
  size?: keyof typeof LINE_SIZE;
  rows?: number;
  /** One width for every row, or one per row (the last repeats). */
  width: Length | Length[];
}) {
  const widths = Array.isArray(width) ? width : [width];

  return (
    <div className="ui-skeleton-text">
      {Array.from({ length: Math.max(rows, 1) }).map((_, index) => (
        <div
          className={cn("ui-skeleton ui-skeleton-line", LINE_SIZE[size])}
          key={index}
          style={{ width: widths[index] ?? widths.at(-1) }}
        />
      ))}
    </div>
  );
}

function SkeletonButton({
  className,
  icon,
  size = "middle",
}: {
  className?: string;
  /** An icon-only button, as wide as it is tall. */
  icon?: boolean;
  size?: "middle" | "small";
}) {
  return (
    <div
      aria-hidden
      className={cn("ui-skeleton ui-skeleton-button", className)}
      data-icon={icon || undefined}
      data-size={size}
    />
  );
}

export const Skeleton = Object.assign(SkeletonRoot, {
  Button: SkeletonButton,
  Inline: SkeletonInline,
  Text: SkeletonText,
});
