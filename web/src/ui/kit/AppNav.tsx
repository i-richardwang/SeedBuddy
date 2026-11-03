import { Collapsible } from "@base-ui/react/collapsible";
import { Play } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { useAppShell } from "./AppShell";
import { Icon, type IconProps } from "./Icon";
import { ScrollShadow } from "./ScrollShadow";
import { OverflowTooltip } from "./Tooltip";

export interface AppNavItem {
  href: string;
  icon: IconProps["icon"];
  label: string;
}

/**
 * A titled run of places under the main ones, such as the experiments:
 * its heading (12px, 500, secondary) with the count after it folds the run
 * away, the panel closing over its rows as they fade. Its items carry 16px
 * icons.
 */
export interface AppNavGroup {
  /** Shown in place of the items when there are none. */
  empty: string;
  items: AppNavItem[];
  key: string;
  label: string;
}

export interface AppNavLinkProps {
  "aria-current"?: "page";
  children: ReactNode;
  className: string;
  "data-active": boolean;
  href: string;
  /** Closes the compact navigation drawer. */
  onClick: () => void;
}

/** Whether `pathname` is the item's page or one below it. */
export function matchesNavPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Longest matching href wins, so a nested page lights up only its own item. */
function resolveActiveHref(pathname: string, items: readonly AppNavItem[]) {
  return items
    .filter((item) => matchesNavPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

/**
 * The sidebar's list of places: each a 36px row with its icon in a 28px slot.
 * The current place is filled; the others stay secondary until hovered.
 * `groups` follow the places, 8px apart, each open at first.
 */
export function AppNav({
  groups,
  items,
  pathname,
  renderLink,
}: {
  groups: AppNavGroup[];
  items: AppNavItem[];
  pathname: string;
  /**
   * Renders each item link, for example as a router link that receives
   * `href`, `className`, the `data-*` and `aria-*` props and `onClick`.
   */
  renderLink: (props: AppNavLinkProps) => ReactNode;
}) {
  const activeHref = resolveActiveHref(pathname, [
    ...items,
    ...groups.flatMap((group) => group.items),
  ]);
  const link = (item: AppNavItem, iconSize: number) => (
    <AppNavLink
      active={item.href === activeHref}
      iconSize={iconSize}
      item={item}
      key={item.href}
      renderLink={renderLink}
    />
  );
  return (
    <ScrollShadow
      aria-label={m.ui_nav_label()}
      as="nav"
      className="ui-app-nav"
      size={4}
    >
      <div className="ui-app-nav-places">
        {items.map((item) => link(item, 18))}
      </div>
      {groups.map((group) => (
        <Collapsible.Root
          className="ui-app-nav-group"
          defaultOpen
          key={group.key}
        >
          <Collapsible.Trigger className="ui-app-nav-group-trigger">
            <span className="ui-app-nav-group-label">{group.label}</span>
            {group.items.length > 0 ? <span>{group.items.length}</span> : null}
            <span aria-hidden className="ui-app-nav-group-indicator">
              <Play fill="currentColor" size={7} strokeWidth={1} />
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel className="ui-app-nav-group-panel">
            <div className="ui-app-nav-group-content">
              {group.items.length > 0 ? (
                group.items.map((item) => link(item, 16))
              ) : (
                <p className="ui-app-nav-group-empty">{group.empty}</p>
              )}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
    </ScrollShadow>
  );
}

function AppNavLink({
  active,
  iconSize,
  item,
  renderLink,
}: {
  active: boolean;
  iconSize: number;
  item: AppNavItem;
  renderLink: (props: AppNavLinkProps) => ReactNode;
}) {
  const shell = useAppShell();
  return renderLink({
    "aria-current": active ? "page" : undefined,
    children: (
      <>
        <span className="ui-app-nav-item-icon">
          <Icon icon={item.icon} size={iconSize} />
        </span>
        <OverflowTooltip placement="right" title={item.label}>
          <span className="ui-app-nav-item-label">{item.label}</span>
        </OverflowTooltip>
      </>
    ),
    className: "ui-app-nav-item",
    "data-active": active,
    href: item.href,
    onClick: shell.closeNavigation,
  });
}
