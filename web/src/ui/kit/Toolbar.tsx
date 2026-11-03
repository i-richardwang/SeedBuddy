import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { cn } from "./cn";
import { Center } from "./Flex";
import { TooltipGroup } from "./Tooltip";

/*
 * A row of controls on an outlined surface with a raised edge shadow; callers
 * position it, for example over an image canvas. Arrow keys move focus between
 * `ToolbarButton`s; callers pass their buttons through `ToolbarButton`'s
 * `render`. Its controls share one tooltip, which glides between them.
 */

interface ToolbarProps extends Omit<
  ToolbarPrimitive.Root.Props,
  "className" | "orientation" | "disabled"
> {
  className?: string;
}

export function Toolbar({ children, className, ...props }: ToolbarProps) {
  return (
    <ToolbarPrimitive.Root
      className={cn("ui-toolbar", className)}
      orientation="horizontal"
      render={<Center horizontal padding={2} />}
      {...props}
    >
      <TooltipGroup>{children}</TooltipGroup>
    </ToolbarPrimitive.Root>
  );
}

export const ToolbarButton: typeof ToolbarPrimitive.Button =
  ToolbarPrimitive.Button;

/** A vertical line between groups of controls. */
export function ToolbarSeparator(
  props: Omit<ToolbarPrimitive.Separator.Props, "className">,
) {
  return (
    <ToolbarPrimitive.Separator className="ui-toolbar-separator" {...props} />
  );
}
