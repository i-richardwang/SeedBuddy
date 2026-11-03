import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";

import { cn } from "./cn";

/*
 * Layout props become `--ui-flex-*` variables on the element; Flex.css maps
 * them onto the matching properties. The default axis is vertical. Numbers
 * are pixels.
 */

type ContentPosition =
  | "center"
  | "end"
  | "flex-end"
  | "flex-start"
  | "start"
  | "stretch"
  | "baseline";

export interface FlexboxProps extends HTMLAttributes<HTMLElement> {
  align?: ContentPosition;
  as?: ElementType;
  children?: ReactNode;
  gap?: number | string;
  height?: number | string;
  horizontal?: boolean;
  justify?: CSSProperties["justifyContent"];
  padding?: number | string;
  paddingBlock?: number | string;
  ref?: Ref<HTMLElement>;
  wrap?: CSSProperties["flexWrap"];
}

const cssValue = (value: number | string) =>
  typeof value === "number" ? `${value}px` : value;

export function Flexbox({
  gap,
  horizontal,
  align,
  justify,
  height,
  padding,
  paddingBlock,
  as: Container = "div",
  className,
  style,
  children,
  wrap,
  ref,
  ...props
}: FlexboxProps) {
  const vars: Record<string, string> = {};
  if (horizontal) vars["--ui-flex-direction"] = "row";
  if (wrap !== undefined) vars["--ui-flex-wrap"] = wrap;
  if (justify !== undefined) vars["--ui-flex-justify"] = justify;
  if (align !== undefined) vars["--ui-flex-align"] = align;
  if (height !== undefined) vars["--ui-flex-height"] = cssValue(height);
  if (padding !== undefined) vars["--ui-flex-padding"] = cssValue(padding);
  if (paddingBlock !== undefined)
    vars["--ui-flex-padding-block"] = cssValue(paddingBlock);
  if (gap !== undefined) vars["--ui-flex-gap"] = cssValue(gap);

  return (
    <Container
      ref={ref}
      {...props}
      className={cn("ui-flex", className)}
      style={{ ...(vars as CSSProperties), ...style }}
    >
      {children}
    </Container>
  );
}

/** A Flexbox centered on both axes. */
export function Center(props: Omit<FlexboxProps, "align" | "justify">) {
  return <Flexbox {...props} align="center" justify="center" />;
}
