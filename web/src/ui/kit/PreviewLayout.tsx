import { type ReactNode, useRef } from "react";

import { AppShellFlush, AppShellPane } from "./AppShell";
import { SidePanel } from "./SidePanel";

export interface Preview {
  title: string;
  content: ReactNode;
  onClose: () => void;
}

/*
 * A document page that shows one of its rows beside it. The page fills the
 * shell's card and scrolls in its own column, padded as the card pads a
 * page; while `preview` is set the row stands in a dismissible `SidePanel`
 * at the card's end.
 */
export function PreviewLayout({
  children,
  preview,
}: {
  children: ReactNode;
  preview: Preview | null;
}) {
  // A drawer keeps showing what it held while it closes.
  const shown = useRef(preview);
  if (preview) shown.current = preview;
  const held = preview ?? shown.current;

  return (
    <AppShellFlush>
      <AppShellPane>{children}</AppShellPane>
      {held ? (
        <SidePanel
          dismissible
          open={preview !== null}
          title={held.title}
          onClose={() => preview?.onClose()}
        >
          {held.content}
        </SidePanel>
      ) : null}
    </AppShellFlush>
  );
}

/** A picture at the top of a preview, whole and centered on a band of fill. */
export function PreviewMedia({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="ui-preview-media">
      <img alt={alt} decoding="async" key={src} loading="lazy" src={src} />
    </div>
  );
}
