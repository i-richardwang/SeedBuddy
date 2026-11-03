import { ChevronDown, ChevronRight, House, PanelLeft } from "lucide-react";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "./ActionIcon";
import { Avatar } from "./Avatar";
import { cn } from "./cn";
import { DraggablePanel } from "./DraggablePanel";
import { Drawer } from "./Drawer";
import { type DropdownItem, DropdownMenu } from "./DropdownMenu";
import { Flexbox } from "./Flex";
import { Icon } from "./Icon";
import { useIsCompact } from "./mediaQuery";
import { TooltipGroup } from "./Tooltip";

export interface AppShellState {
  /** Closes the compact navigation drawer. */
  closeNavigation: () => void;
}

const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const value = use(AppShellContext);
  if (!value) throw new Error("useAppShell must be used within AppShell");
  return value;
}

export interface AppShellLinkProps {
  "aria-label"?: string;
  children: ReactNode;
  className: string;
  href: string;
  /** Closes the compact navigation drawer. */
  onClick: () => void;
}

/**
 * The sidebar's top row inside a section that replaces the navigation, such
 * as settings: a home link, then the section's name.
 */
export function AppShellTrail({
  home,
  renderLink,
  title,
}: {
  home: { href: string; label: string };
  renderLink: (props: AppShellLinkProps) => ReactNode;
  title: string;
}) {
  const shell = useAppShell();
  return (
    <nav aria-label={m.ui_breadcrumb_label()} className="ui-app-shell-trail">
      {renderLink({
        "aria-label": home.label,
        children: <Icon icon={House} size={14} />,
        className: "ui-app-shell-trail-link",
        href: home.href,
        onClick: shell.closeNavigation,
      })}
      <Icon
        aria-hidden
        className="ui-app-shell-trail-separator"
        icon={ChevronRight}
        size={12}
      />
      <span aria-current="page" className="ui-app-shell-trail-page">
        {title}
      </span>
    </nav>
  );
}

/**
 * The signed-in person on the sidebar's top row, opening their menu: their
 * avatar, their name and a chevron.
 */
export function AppShellAccount({
  items,
  label,
  name,
}: {
  items: DropdownItem[];
  /** Names the menu button. */
  label: string;
  name: string;
}) {
  return (
    <DropdownMenu items={items}>
      <button aria-label={label} className="ui-app-shell-account" type="button">
        <Avatar name={name} />
        <span className="ui-app-shell-account-name">{name}</span>
        <Icon
          className="ui-app-shell-account-chevron"
          icon={ChevronDown}
          size={14}
        />
      </button>
    </DropdownMenu>
  );
}

export interface AppShellProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Location shown in the top bar, usually a `Breadcrumb`. */
  breadcrumb: ReactNode;
  children?: ReactNode;
  /** Hide the sidebar. Ignored while compact. */
  collapsed: boolean;
  /** Pinned to the bottom of the sidebar, a row of `ActionIcon`s. */
  footer: ReactNode;
  /** The sidebar's top row: an `AppShellAccount` or an `AppShellTrail`. */
  header: ReactNode;
  /** Navigation, usually an `AppNav`. */
  navigation: ReactNode;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Actions at the end of the top bar. */
  tools: ReactNode;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * The workspace card's content edge to edge: it cancels the card's padding
 * and fills its height, for a page that lays out its own panes and scrolling.
 */
export function AppShellFlush({ children }: { children: ReactNode }) {
  return <div className="ui-app-shell-flush">{children}</div>;
}

/** A column inside `AppShellFlush` that scrolls and pads its content as the card pads a page. */
export function AppShellPane({ children }: { children: ReactNode }) {
  return <div className="ui-app-shell-pane">{children}</div>;
}

/** The sidebar opens 240px wide and is dragged at its seam up to 400px. */
const SIDEBAR_WIDTH = { default: 240, min: 240, max: 400 };
const TOGGLE_HOTKEY = "mod+b";

/**
 * App frame: a sidebar on the canvas and the page in a bordered card with a
 * 44px top bar. The sidebar is resized at its seam and folds away entirely
 * when collapsed, its toggle moving from the sidebar's top row to the start
 * of the top bar; below the laptop breakpoint it is a drawer. Mod+B toggles
 * it while focus is inside the shell. The toggle and the account's chevron
 * show while the pointer or focus is in the sidebar.
 */
export function AppShell({
  breadcrumb,
  children,
  className,
  collapsed,
  footer,
  header,
  navigation,
  onCollapsedChange,
  tools,
  ...rest
}: AppShellProps) {
  const mainId = `app-main-${useId().replaceAll(":", "")}`;
  const shellRef = useRef<HTMLDivElement>(null);
  const isCompact = useIsCompact();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The workspace shows a focus ring only when the skip link moved focus there.
  const [skippedToMain, setSkippedToMain] = useState(false);
  const hidden = collapsed && !isCompact;

  const closeNavigation = () => setDrawerOpen(false);
  const toggleNavigation = () => {
    if (isCompact) {
      setDrawerOpen((open) => !open);
      return;
    }
    onCollapsedChange(!collapsed);
  };
  const toggleRef = useRef(toggleNavigation);
  useEffect(() => {
    toggleRef.current = toggleNavigation;
  });

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "b" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }
      if (event.repeat || isTypingTarget(event.target)) return;
      if (!node.contains(event.target as Node)) return;
      event.preventDefault();
      toggleRef.current();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggle = (
    <ActionIcon
      icon={PanelLeft}
      size="header"
      title={
        isCompact
          ? m.ui_shell_open_navigation()
          : hidden
            ? m.ui_shell_expand()
            : m.ui_shell_collapse()
      }
      tooltipProps={isCompact ? undefined : { hotkey: TOGGLE_HOTKEY }}
      onClick={toggleNavigation}
    />
  );

  const sidebar = (
    <AppShellContext value={{ closeNavigation }}>
      <TooltipGroup>
        <div className="ui-app-shell-sidebar-header">
          <div className="ui-app-shell-sidebar-header-main">{header}</div>
          {isCompact ? null : (
            <span className="ui-app-shell-sidebar-toggle">{toggle}</span>
          )}
        </div>
        <div className="ui-app-shell-nav-slot">{navigation}</div>
        <div className="ui-app-shell-sidebar-footer">{footer}</div>
      </TooltipGroup>
    </AppShellContext>
  );

  return (
    <div
      className={cn("ui-app-shell", className)}
      data-sidebar={hidden || isCompact ? "hidden" : "shown"}
      ref={shellRef}
      {...rest}
    >
      <a
        className="ui-app-shell-skip-link"
        href={`#${mainId}`}
        onClick={(event) => {
          event.preventDefault();
          setSkippedToMain(true);
          document.getElementById(mainId)?.focus();
        }}
      >
        {m.ui_shell_skip_to_content()}
      </a>
      {isCompact ? (
        <Drawer
          aria-label={m.ui_nav_label()}
          noHeader
          open={drawerOpen}
          placement="left"
          width={280}
          onClose={closeNavigation}
        >
          <Flexbox className="ui-app-shell-drawer" height="100%">
            {sidebar}
          </Flexbox>
        </Drawer>
      ) : (
        <DraggablePanel
          aria-label={m.ui_shell_sidebar()}
          border={false}
          className="ui-app-shell-sidebar"
          defaultWidth={SIDEBAR_WIDTH.default}
          expand={!hidden}
          maxWidth={SIDEBAR_WIDTH.max}
          minWidth={SIDEBAR_WIDTH.min}
          placement="left"
        >
          {sidebar}
        </DraggablePanel>
      )}
      <div className="ui-app-shell-workspace">
        <header
          className="ui-app-shell-topbar"
          data-toggle={hidden || isCompact ? "" : undefined}
        >
          <TooltipGroup>
            {hidden || isCompact ? toggle : null}
            <div className="ui-app-shell-topbar-main">{breadcrumb}</div>
            <div className="ui-app-shell-tools">{tools}</div>
          </TooltipGroup>
        </header>
        <main
          className="ui-app-shell-main"
          data-skip-target={skippedToMain || undefined}
          id={mainId}
          tabIndex={-1}
          onBlur={(event) => {
            if (event.target === event.currentTarget) setSkippedToMain(false);
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
