import { mergeProps } from "@base-ui/react/merge-props";
import { cloneElement, type ReactElement, type Ref } from "react";

import { isNativeButtonElement } from "./nativeButton";
import { mergeRefs } from "./refs";

/*
 * Shared by the popup components. Popups portal to `<body>` and share the
 * `--z-index-popup` step. Portals are appended to `<body>` in opening order,
 * so a later popup comes later in the document and covers earlier ones. The
 * container is always passed explicitly; otherwise Base UI nests a popup
 * inside the outer popup's portal.
 */

/** Where popups portal. Popups open only in the browser; the server has no document. */
export const defaultPortalContainer = (): HTMLElement | undefined =>
  typeof document === "undefined" ? undefined : document.body;

type TriggerChildProps = Record<string, unknown> & { ref?: Ref<never> };

/**
 * `render` for popup triggers: Base UI's props and ref merge into the child
 * itself. Base UI's `type="button"` goes only to a literal `<button>`; a
 * component child (Button, ActionIcon) uses `type` for its look and sets the
 * native type itself.
 */
export function triggerRender(children: ReactElement) {
  const child = children as ReactElement<TriggerChildProps>;
  return (props: object) => {
    const { ref, type, ...rest } = props as TriggerChildProps & {
      type?: string;
    };
    const own = isNativeButtonElement(child) ? { ...rest, type } : rest;
    return cloneElement(child, {
      ...(mergeProps(child.props, own) as TriggerChildProps),
      ref: mergeRefs([child.props.ref, ref]),
    });
  };
}
