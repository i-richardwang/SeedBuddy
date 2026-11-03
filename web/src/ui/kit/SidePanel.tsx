import { X } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "./ActionIcon";
import { DraggablePanel } from "./DraggablePanel";
import { Drawer } from "./Drawer";
import { useIsCompact } from "./mediaQuery";

/** 360px wide by default, resizable from 300 to 600. */
const WIDTH = { default: 360, min: 300, max: 600 };

/*
 * The one panel that stands beside a page's main content, at the end of the
 * shell's card: a workbench's inspector, a document page's preview of a row.
 * It is resized at its seam (`DraggablePanel`) and folds away while not
 * `open`, and its content is stacked 16px apart in a padded column that
 * scrolls on its own. A `dismissible` panel, which shows something the
 * reader chose, carries its `title` and a close button over the content; one
 * that stays is named by its `title` for assistive technology only, and is
 * folded and brought back by its page. Below the laptop breakpoint the panel
 * is a drawer, titled, shown while `open`.
 */
export function SidePanel({
  children,
  dismissible,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  dismissible?: boolean;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const compact = useIsCompact();
  const stack = <div className="ui-side-panel-stack">{children}</div>;

  if (compact) {
    return (
      <Drawer open={open} title={title} width={WIDTH.default} onClose={onClose}>
        {stack}
      </Drawer>
    );
  }
  return (
    <DraggablePanel
      aria-label={title}
      defaultWidth={WIDTH.default}
      expand={open}
      maxWidth={WIDTH.max}
      minWidth={WIDTH.min}
    >
      {dismissible ? (
        <header className="ui-side-panel-header">
          <h2 className="ui-side-panel-title">{title}</h2>
          <ActionIcon
            icon={X}
            size="small"
            title={m.ui_close()}
            onClick={onClose}
          />
        </header>
      ) : null}
      <div className="ui-side-panel-body">{stack}</div>
    </DraggablePanel>
  );
}
