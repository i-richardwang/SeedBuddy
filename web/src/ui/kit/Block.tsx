import { cn } from "./cn";
import { Flexbox, type FlexboxProps } from "./Flex";

/* A surface: a Flexbox with a surface style. */

interface BlockProps extends FlexboxProps {
  variant?: "filled" | "outlined";
}

const VARIANT = {
  filled: "ui-block-filled",
  outlined: "ui-block-outlined",
} satisfies Record<NonNullable<BlockProps["variant"]>, string>;

export function Block({ className, variant = "filled", ...rest }: BlockProps) {
  return (
    <Flexbox
      className={cn("ui-block", VARIANT[variant], className)}
      {...rest}
    />
  );
}
