import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "./cn";

/* A link to an object's detail, such as a name in a table cell. `render` takes a router `<Link>`. */

export function TextLink({
  className,
  render,
  ...props
}: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(props, { className: cn("ui-text-link", className) }),
    render,
  });
}
