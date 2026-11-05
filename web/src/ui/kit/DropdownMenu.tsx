import { Menu } from "@base-ui/react/menu";
import type { LucideIcon } from "lucide-react";
import type { Key, ReactElement } from "react";

import { cn } from "./cn";
import { defaultPortalContainer, triggerRender } from "./floating";
import { Icon } from "./Icon";
import { resolveNativeButton } from "./nativeButton";

/*
 * A menu opened by clicking its trigger. `items` describes the menu (plain
 * items and dividers); an item with `href` is a link, such as a download the
 * server sends as an attachment. Base UI owns the open state and mounts the
 * items only while the menu is open or closing. When any item has an icon,
 * every item reserves the icon slot so labels line up. The trigger gets no
 * class: its open fill is selected by `[aria-haspopup="menu"][data-popup-
 * open]` in the base layer of `app.css`, and the base focus ring skips
 * elements with `ui-` classes.
 */

interface MenuItemType {
  danger?: boolean;
  disabled?: boolean;
  href?: string;
  icon?: LucideIcon;
  key: Key;
  label: string;
  onClick?: () => void;
  type?: "item";
}

interface MenuDividerType {
  type: "divider";
}

export type DropdownItem = MenuItemType | MenuDividerType;

function renderItems(items: DropdownItem[]) {
  const reserveIconSpace = items.some(
    (item) => item.type !== "divider" && item.icon,
  );
  return items.map((item, index) => {
    if (item.type === "divider") {
      return (
        <Menu.Separator className="ui-dropdown-menu-separator" key={index} />
      );
    }
    const className = cn(
      "ui-dropdown-menu-item",
      item.danger && "ui-dropdown-menu-danger",
    );
    return item.href ? (
      <Menu.LinkItem
        className={className}
        closeOnClick
        href={item.href}
        key={item.key}
        label={item.label}
      >
        <MenuItemContent item={item} reserveIconSpace={reserveIconSpace} />
      </Menu.LinkItem>
    ) : (
      <Menu.Item
        className={className}
        disabled={item.disabled}
        key={item.key}
        label={item.label}
        onClick={item.onClick}
      >
        <MenuItemContent item={item} reserveIconSpace={reserveIconSpace} />
      </Menu.Item>
    );
  });
}

function MenuItemContent({
  item,
  reserveIconSpace,
}: {
  item: MenuItemType;
  reserveIconSpace: boolean;
}) {
  return (
    <div className="ui-dropdown-menu-item-content">
      {reserveIconSpace ? (
        <span aria-hidden={!item.icon} className="ui-dropdown-menu-icon">
          {item.icon ? <Icon icon={item.icon} /> : null}
        </span>
      ) : null}
      <span className="ui-dropdown-menu-label">{item.label}</span>
    </div>
  );
}

interface DropdownMenuProps {
  /** The trigger: a single element such as a Button or ActionIcon. */
  children: ReactElement;
  items: DropdownItem[];
  /** The menu opens below the trigger, lined up with its start or end edge. */
  align?: "start" | "end";
  /** Keeps the menu shut. */
  disabled?: boolean;
}

export function DropdownMenu({
  children,
  items,
  align = "start",
  disabled = false,
}: DropdownMenuProps) {
  return (
    <Menu.Root modal={false} disabled={disabled}>
      <Menu.Trigger
        nativeButton={resolveNativeButton(children)}
        render={triggerRender(children)}
      />
      <Menu.Portal container={defaultPortalContainer()}>
        <Menu.Positioner
          align={align}
          className="ui-dropdown-menu-positioner"
          side="bottom"
          sideOffset={6}
        >
          <Menu.Popup className="ui-dropdown-menu-popup">
            {renderItems(items)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
