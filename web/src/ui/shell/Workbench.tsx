import { PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "../kit/ActionIcon";
import { AppShellFlush } from "../kit/AppShell";
import { Empty, type EmptyProps } from "../kit/Empty";
import { useIsCompact } from "../kit/mediaQuery";
import { SectionHeader } from "../kit/SectionHeader";
import { SidePanel } from "../kit/SidePanel";
import { Skeleton } from "../kit/Skeleton";
import { Toolbar } from "../kit/Toolbar";
import { StepperSkeleton } from "../Stepper";
import {
  ShellActions,
  ShellInspectorToggle,
  ShellTrail,
  useInspectorFold,
} from "./Shell";

/** Where floating content over the subject's top edge, and the bar under it, land. */
const FloatSlots = createContext<{
  toolbar: HTMLElement | null;
  alert: HTMLElement | null;
  footer: HTMLElement | null;
} | null>(null);

const StatusSlot = createContext<HTMLElement | null>(null);

const InspectorSlot = createContext<{
  node: HTMLElement | null;
  mount: () => () => void;
} | null>(null);

/**
 * A page built around one framed subject. It fills the shell's card edge to
 * edge: the subject on the left with its controls and lasting notices
 * floating over its top edge and the way through its siblings in a bar under
 * it, facts in an inspector panel on the right. The shell's top bar stands
 * for the header a document page has: the way back up ending in the subject,
 * the subject's status after it (`WorkbenchStatus`), and its commands at the
 * bar's end, the last of them folding the inspector away and bringing it
 * back. The inspector is a `SidePanel`; on narrow screens that command opens
 * its drawer.
 *
 * The frame outlives its subject: stepping to the next subject replaces what
 * the slots hold and leaves the frame, its panel's width and its footer in
 * place.
 */
export function Workbench({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const compact = useIsCompact();
  const fold = useInspectorFold();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [alertSlot, setAlertSlot] = useState<HTMLDivElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLSpanElement | null>(null);
  const [inspectorNode, setInspectorNode] = useState<HTMLDivElement | null>(
    null,
  );
  const [inspectors, setInspectors] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inspector] = useState(() => ({
    mount: () => {
      setInspectors((count) => count + 1);
      return () => setInspectors((count) => count - 1);
    },
  }));
  const hasInspector = inspectors > 0;

  return (
    <FloatSlots
      value={{ toolbar: toolbarSlot, alert: alertSlot, footer: footerSlot }}
    >
      <InspectorSlot value={{ node: inspectorNode, mount: inspector.mount }}>
        <StatusSlot value={statusSlot}>
          <h1 className="sr-only">{title}</h1>
          <ShellTrail
            status={<span ref={setStatusSlot} className="contents" />}
          />
          <AppShellFlush>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-container-secondary">
              <div className="pointer-events-none absolute inset-x-0 top-3 z-raise flex flex-col items-center gap-2 px-3">
                <div
                  ref={setToolbarSlot}
                  className="pointer-events-auto flex max-w-full items-center gap-2"
                />
                <div
                  ref={setAlertSlot}
                  className="pointer-events-auto w-full max-w-md empty:hidden"
                />
              </div>
              {children}
              <div
                ref={setFooterSlot}
                className="flex h-11 flex-none items-center gap-3 overflow-x-auto border-t bg-container px-3 empty:hidden"
              />
            </div>
            {hasInspector ? (
              <SidePanel
                open={compact ? drawerOpen : !fold.collapsed}
                title={m.workbench_inspector()}
                onClose={() => setDrawerOpen(false)}
              >
                {/* The inspector's sections are portaled here and stacked by the panel. */}
                <div ref={setInspectorNode} className="contents" />
              </SidePanel>
            ) : null}
          </AppShellFlush>
          {hasInspector ? (
            <ShellInspectorToggle>
              <ActionIcon
                aria-expanded={compact ? drawerOpen : !fold.collapsed}
                icon={
                  compact || fold.collapsed ? PanelRightOpen : PanelRightClose
                }
                size="header"
                title={m.workbench_inspector()}
                onClick={() =>
                  compact
                    ? setDrawerOpen(true)
                    : fold.onCollapsedChange(!fold.collapsed)
                }
              />
            </ShellInspectorToggle>
          ) : null}
        </StatusSlot>
      </InspectorSlot>
    </FloatSlots>
  );
}

/** The state the framed subject is in, after its name in the top bar. */
export function WorkbenchStatus({ children }: { children: ReactNode }) {
  const slot = use(StatusSlot);
  if (!slot) return null;
  return createPortal(children, slot);
}

/** Facts about the framed subject, shown in the workbench's inspector. */
export function WorkbenchInspector({ children }: { children: ReactNode }) {
  const slot = use(InspectorSlot);
  if (!slot) {
    throw new Error("WorkbenchInspector requires Workbench");
  }
  const { mount } = slot;
  useLayoutEffect(mount, [mount]);
  if (!slot.node) return null;
  return createPortal(children, slot.node);
}

const SECTION = "flex flex-col gap-2 border-b pb-4";

/**
 * A group of the inspector under its compact `SectionHeader`, ruled off from
 * the next. The first group, which leads with the subject's figure on a
 * `StatisticHero`, is named by the figure and has no `title`.
 */
export function WorkbenchSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className={SECTION}>
      {title ? <SectionHeader size="compact" title={title} /> : null}
      {children}
    </section>
  );
}

/** Controls for the framed subject, floating over its top edge. */
export function WorkbenchToolbar({
  label,
  children,
  inert,
}: {
  label: string;
  children: ReactNode;
  inert?: boolean;
}) {
  const slot = use(FloatSlots)?.toolbar;
  if (!slot) return null;
  return createPortal(
    <Toolbar aria-label={label} inert={inert || undefined}>
      {children}
    </Toolbar>,
    slot,
  );
}

/**
 * The bar under the subject: the way to the subjects beside it, such as the
 * previous and next image, and along any other axis they are ordered on.
 */
export function WorkbenchFooter({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const slot = use(FloatSlots)?.footer;
  if (!slot) return null;
  return createPortal(
    <nav aria-label={label} className="contents">
      {children}
    </nav>,
    slot,
  );
}

/** A state of the subject that lasts while it is open, floating under its toolbar. */
export function WorkbenchAlert({ children }: { children: ReactNode }) {
  const slot = use(FloatSlots)?.alert;
  if (!slot) return null;
  return createPortal(children, slot);
}

/** The subject's place when there is nothing to frame: what is missing and the way forward. */
export function WorkbenchEmpty(props: Omit<EmptyProps, "type">) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty type="page" {...props} />
    </div>
  );
}

/**
 * The loading shape of a workbench: the subject's frame filled edge to edge,
 * as the subject will fill it, over the steps in the footer's bar. `actions`
 * stand where the page's commands will in the top bar, `subject` stands for
 * a subject laid out in parts of its own, and the children are the
 * inspector's sections, each the skeleton of the section it stands for.
 */
export function WorkbenchSkeleton({
  actions,
  subject = <Skeleton aria-hidden height="auto" radius={0} />,
  children,
}: {
  actions?: ReactNode;
  subject?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Workbench title={m.ui_page_loading()}>
      {actions ? <ShellActions>{actions}</ShellActions> : null}
      <WorkbenchInspector>{children}</WorkbenchInspector>
      <WorkbenchFooter label={m.ui_page_loading()}>
        <StepperSkeleton />
      </WorkbenchFooter>
      <div aria-busy="true" className="flex min-h-0 flex-1">
        <output aria-live="polite" className="sr-only">
          {m.ui_page_loading()}
        </output>
        {subject}
      </div>
    </Workbench>
  );
}

/** A titled `WorkbenchSection` while it loads; the children are what it will hold. */
export function WorkbenchSectionSkeleton({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div aria-hidden className={SECTION}>
      <Skeleton.Text size="xs" width="4em" />
      {children}
    </div>
  );
}
