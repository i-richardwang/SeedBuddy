import { Link, useRouterState } from "@tanstack/react-router";
import {
  Beaker,
  CircleUser,
  FlaskConical,
  KeyRound,
  Network,
  Server,
  Users,
} from "lucide-react";
import { createContext, type ReactNode, use, useState } from "react";
import { createPortal } from "react-dom";

import { isAdmin, type WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import {
  AppNav,
  type AppNavGroup,
  type AppNavItem,
  type AppNavLinkProps,
  matchesNavPath,
} from "../kit/AppNav";
import {
  AppShell,
  type AppShellLinkProps,
  AppShellTrail,
} from "../kit/AppShell";
import {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbLinkProps,
} from "../kit/Breadcrumb";
import { ColorSchemeMenu } from "../Preferences";
import { useCrumbs } from "./crumbs";

const HOME = "/experiments";

function places(): AppNavItem[] {
  return [
    { href: HOME, icon: FlaskConical, label: m.experiments_label() },
    { href: "/models", icon: Network, label: m.models_label() },
  ];
}

/** The experiments, each a place of its own under the main ones. */
function experimentGroup(
  experiments: { id: string; name: string }[],
): AppNavGroup {
  return {
    key: "experiments",
    label: m.experiments_label(),
    empty: m.experiments_empty(),
    items: experiments.map((experiment) => ({
      href: `/experiments/${experiment.id}`,
      icon: Beaker,
      label: experiment.name,
    })),
  };
}

/** The settings section, which takes the sidebar's place while one of its pages is open. */
function settingsPlaces(user: WorkbenchUser): AppNavItem[] {
  const items: AppNavItem[] = [
    { href: "/account", icon: CircleUser, label: m.account_label() },
    { href: "/integrations", icon: KeyRound, label: m.integrations_label() },
    { href: "/workers", icon: Server, label: m.workers_label() },
  ];
  if (isAdmin(user)) {
    items.push({ href: "/users", icon: Users, label: m.users_label() });
  }
  return items;
}

/*
 * The router sets `aria-current="page"` on a link it counts as active, over
 * the kit's own marking; matching exactly keeps it off the ancestors a
 * breadcrumb links to.
 */
const routerLink = ({
  href,
  ...props
}: AppShellLinkProps | AppNavLinkProps | BreadcrumbLinkProps) => (
  <Link {...props} to={href} activeOptions={{ exact: true }} />
);

const TopBarSlots = createContext<{
  actions: HTMLElement | null;
  inspector: HTMLElement | null;
  trail: HTMLElement | null;
}>({ actions: null, inspector: null, trail: null });

const InspectorFold = createContext<{
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}>({ collapsed: false, onCollapsedChange: () => {} });

/** Whether a workbench's inspector is folded, a choice kept from one subject to the next. */
export function useInspectorFold() {
  return use(InspectorFold);
}

/** A workbench's commands, at the end of the shell's top bar. */
export function ShellActions({ children }: { children: ReactNode }) {
  const slot = use(TopBarSlots).actions;
  if (!slot) return null;
  return createPortal(children, slot);
}

/** The command folding a workbench's inspector, after every other command in the top bar. */
export function ShellInspectorToggle({ children }: { children: ReactNode }) {
  const slot = use(TopBarSlots).inspector;
  if (!slot) return null;
  return createPortal(children, slot);
}

/**
 * The way back up from a page below the top level: the breadcrumb at the
 * start of the shell's top bar, its last crumb the page itself, followed by
 * the `status` of a workbench's subject, which has no header of its own.
 */
export function ShellTrail({ status }: { status?: ReactNode }) {
  const slot = use(TopBarSlots).trail;
  if (!slot) return null;
  return createPortal(
    <>
      <Trail />
      {status}
    </>,
    slot,
  );
}

/**
 * The signed-in frame: navigation on the canvas, the page in a card whose
 * top bar shows only when it has something to hold: the sidebar's toggle
 * while the sidebar is hidden, the way back up on any page below the top
 * level, and a workbench's commands.
 * The sidebar opens with the signed-in person, lists the places and then the
 * experiments, and ends with the color scheme. A settings page swaps the
 * person and the places for a trail home and the settings section. Whether
 * the sidebar is hidden, and whether a workbench's inspector is folded, are
 * owned by the caller so the server renders the stored choices.
 */
export function Shell({
  children,
  account,
  experiments,
  user,
  collapsed,
  onCollapsedChange,
  inspectorCollapsed,
  onInspectorCollapsedChange,
}: {
  children: ReactNode;
  account: ReactNode;
  experiments: { id: string; name: string }[];
  user: WorkbenchUser;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  inspectorCollapsed: boolean;
  onInspectorCollapsedChange: (collapsed: boolean) => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settings = settingsPlaces(user);
  const inSettings = settings.some((item) =>
    matchesNavPath(pathname, item.href),
  );
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [inspectorSlot, setInspectorSlot] = useState<HTMLDivElement | null>(
    null,
  );
  const [trailSlot, setTrailSlot] = useState<HTMLDivElement | null>(null);

  return (
    <TopBarSlots
      value={{
        actions: actionsSlot,
        inspector: inspectorSlot,
        trail: trailSlot,
      }}
    >
      <InspectorFold
        value={{
          collapsed: inspectorCollapsed,
          onCollapsedChange: onInspectorCollapsedChange,
        }}
      >
        <AppShell
          className="isolate"
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          header={
            inSettings ? (
              <AppShellTrail
                home={{ href: HOME, label: m.nav_home() }}
                title={m.nav_settings()}
                renderLink={routerLink}
              />
            ) : (
              account
            )
          }
          navigation={
            <AppNav
              items={inSettings ? settings : places()}
              groups={inSettings ? [] : [experimentGroup(experiments)]}
              pathname={pathname}
              renderLink={routerLink}
            />
          }
          footer={<ColorSchemeMenu size="middle" />}
          breadcrumb={<div ref={setTrailSlot} className="contents" />}
          tools={
            <>
              <div ref={setActionsSlot} className="contents" />
              <div ref={setInspectorSlot} className="contents" />
            </>
          }
        >
          {children}
        </AppShell>
      </InspectorFold>
    </TopBarSlots>
  );
}

/** The way back up to the current page. */
function Trail() {
  const crumbs = useCrumbs();
  if (crumbs.length < 2) return null;
  const items: BreadcrumbItem[] = crumbs.map((crumb, index) => ({
    href: index === crumbs.length - 1 ? undefined : crumb.href,
    label: crumb.label,
  }));
  return <Breadcrumb items={items} renderLink={routerLink} />;
}
