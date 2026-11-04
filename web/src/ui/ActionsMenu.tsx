import { Ellipsis } from "lucide-react";

import { ActionIcon } from "./kit/ActionIcon";
import { Button } from "./kit/Button";
import { type DropdownItem, DropdownMenu } from "./kit/DropdownMenu";

type ActionsMenuProps = {
  /** Names the trigger, e.g. "Actions for A1". */
  label: string;
  items: DropdownItem[];
};

/**
 * The "…" menu at the end of a table row or list item. While a command of
 * its own is running it is `busy`: a turning ring in place of the dots.
 */
export function RowMenu({
  label,
  items,
  busy,
}: ActionsMenuProps & { busy?: boolean }) {
  return (
    <DropdownMenu items={items} align="end">
      <ActionIcon
        icon={Ellipsis}
        size="small"
        loading={busy}
        aria-label={label}
      />
    </DropdownMenu>
  );
}

/** The "…" menu beside a page's or workbench's primary actions. */
export function PageMenu({ label, items }: ActionsMenuProps) {
  return (
    <DropdownMenu items={items} align="end">
      <Button icon={Ellipsis} aria-label={label} />
    </DropdownMenu>
  );
}
