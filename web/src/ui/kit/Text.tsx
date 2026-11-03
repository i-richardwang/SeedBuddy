import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

/*
 * A run of text on the type scale, rendered as a `div` unless `as` says
 * otherwise. Text takes three colors by what it says: names in the text
 * color, descriptive values `secondary`, and descriptions, dates, metadata
 * and counts beside a name `tertiary`; `quaternary` is a mark that steps
 * back further. `warning` and `error` color a word of state; `success` and
 * `error` a change for the better or the worse. `size` is a step of the
 * type scale, inherited when unset; `weight` is `medium` for a name, and
 * `regular` sets a run apart inside a heavier line such as a column header.
 * `disabled` draws the label of a disabled control; `ellipsis` cuts the
 * text to one line.
 */

const SIZE = {
  xs: "ui-text-xs",
  sm: "ui-text-sm",
  base: "ui-text-base",
  lg: "ui-text-lg",
} as const;

export interface TextProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  disabled?: boolean;
  ellipsis?: boolean;
  size?: keyof typeof SIZE;
  type?:
    "secondary" | "tertiary" | "quaternary" | "success" | "warning" | "error";
  weight?: "regular" | "medium";
}

export function Text({
  as: Container = "div",
  children,
  className,
  disabled,
  ellipsis,
  size,
  type,
  weight,
  ...rest
}: TextProps): ReactNode {
  return (
    <Container
      {...rest}
      className={cn(
        "ui-text",
        size && SIZE[size],
        ellipsis && "ui-text-ellipsis",
        disabled && "ui-text-disabled",
        className,
      )}
      data-type={type}
      data-weight={weight}
    >
      {children}
    </Container>
  );
}
