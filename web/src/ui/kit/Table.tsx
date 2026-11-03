import { ChevronDown } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { m } from "../../paraglide/messages";
import { Checkbox } from "./Checkbox";
import { cn } from "./cn";
import { type DropdownItem, DropdownMenu } from "./DropdownMenu";
import { EmptyPlace } from "./Empty";
import { Icon } from "./Icon";

/*
 * By default the table sits in an outlined card of its own: the header band
 * runs to the card's edges, the first and last columns are inset 16px, and a
 * hairline parts the rows. `variant="borderless"` is for a table inside a
 * surface that already frames it, such as a settings group: a header band
 * and rows on that surface, run to its edges through `--surface-gutter` (see
 * app.css) with the first and last columns inset by the same amount. In the
 * card layout each row is its own outlined card.
 *
 * - `size="small"`: the dense header of a data grid, 12px in the tertiary
 *   color; the default header is 13px in the secondary color.
 * - `empty`: drawn instead of the table, header and all, when there are no
 *   rows; usually an `Empty` with the one way forward. Under a `toolbar` it
 *   takes the rows' place inside the card instead, so the filters stay.
 * - `toolbar` and `footer`: bands inside the card above the header and under
 *   the last row, 12px by 16px and ruled off from the rows; the toolbar
 *   holds a search and filters with commands at its end, the footer a
 *   `Pagination`.
 * - Whole-row click: `TableRow`'s `clickable`. A click anywhere on the row
 *   that is not on a control is passed to the link in its `cellSlot="title"`
 *   cell, modifier keys included, so the link stays the row's one tab stop
 *   and a modified click opens a new tab as on the link itself.
 * - Row actions: the `cellSlot="actions"` cell shows while the row is
 *   hovered, holds focus or has its menu open; on a touch screen and in the
 *   card layout it always shows.
 * - Selection: `TableSelectionHead` (select all, with the mixed state) and
 *   `TableSelectionCell` (one row) hold a checkbox each; a selected row is
 *   `data-state="selected"`. The caller owns the selected set.
 * - `TableHeadMenu`: a column header that opens a menu of the column's
 *   commands, drawn in the header's own type.
 * - Pinned columns: `fixed="start"` / `"end"` on every cell of a column keeps
 *   it in view while the table scrolls sideways; a shadow marks the edge
 *   content is passing under.
 * - `numeric`: the column holds figures, set at the end edge in tabular digits
 *   so they line up; header and body cells of the column both take it.
 * - Grouped columns: a second header row names the columns under each group,
 *   whose head spans them (`colSpan`); the columns outside a group head both
 *   rows (`rowSpan`).
 * - `narrow="cards"`: below 600px of table width each row becomes a card
 *   whose cells carry their `cellLabel` on the left; the default `"scroll"`
 *   scrolls horizontally when the table is wider than its box.
 */

interface TableProps extends Omit<
  ComponentProps<"table">,
  "className" | "style"
> {
  /** Shown in place of the table when it has no rows. */
  empty?: ReactNode;
  /** Under the last row, inside the card. */
  footer?: ReactNode;
  /** Above the header, inside the card. */
  toolbar?: ReactNode;
  narrow?: "scroll" | "cards";
  size?: "small" | "middle";
  variant?: "outlined" | "borderless";
}

export function Table({
  empty,
  footer,
  narrow = "scroll",
  size = "middle",
  toolbar,
  variant = "outlined",
  ...props
}: TableProps) {
  const { contentRef, onScroll, shadow, tableRef } = useFixedColumns();
  const isEmpty = empty != null && empty !== false;
  if (isEmpty && toolbar == null) {
    return <EmptyPlace variant={variant}>{empty}</EmptyPlace>;
  }
  return (
    <div
      data-variant={variant}
      className={cn(
        "ui-table-wrapper",
        size === "small" && "ui-table-small",
        narrow === "cards" && "ui-table-narrow-cards",
      )}
    >
      <div
        className={cn(
          "ui-table",
          shadow.start && "ui-table-fix-start-shadow-show",
          shadow.end && "ui-table-fix-end-shadow-show",
        )}
      >
        {toolbar != null ? (
          <div className="ui-table-toolbar">{toolbar}</div>
        ) : null}
        {isEmpty ? (
          <EmptyPlace>{empty}</EmptyPlace>
        ) : (
          <div className="ui-table-container">
            <div
              className="ui-table-content"
              ref={contentRef}
              onScroll={onScroll}
            >
              <table ref={tableRef} {...props} />
            </div>
          </div>
        )}
        {footer != null && !isEmpty ? (
          <div className="ui-table-footer">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Places pinned cells and tracks which edges have content scrolled under
 * them. A pinned cell sits after the widths of the pinned cells before it in
 * its row (after it, for `end`); offsets are re-measured after every render
 * and whenever the table resizes.
 */
function useFixedColumns() {
  const contentRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [shadow, setShadow] = useState({ start: false, end: false });

  const measureScroll = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const scrolled = Math.abs(content.scrollLeft);
    const start = scrolled > 0;
    const end = scrolled < content.scrollWidth - content.clientWidth - 1;
    setShadow((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  }, []);

  const place = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    for (const row of table.rows) {
      const cells = [...row.cells];
      let start = 0;
      for (const cell of cells) {
        if (!cell.classList.contains("ui-table-cell-fix-start")) continue;
        cell.style.insetInlineStart = `${start}px`;
        start += cell.getBoundingClientRect().width;
      }
      let end = 0;
      for (const cell of cells.reverse()) {
        if (!cell.classList.contains("ui-table-cell-fix-end")) continue;
        cell.style.insetInlineEnd = `${end}px`;
        end += cell.getBoundingClientRect().width;
      }
    }
    measureScroll();
  }, [measureScroll]);

  useLayoutEffect(place);

  useEffect(() => {
    const table = tableRef.current;
    const content = contentRef.current;
    if (!table || !content) return;
    const observer = new ResizeObserver(place);
    observer.observe(table);
    observer.observe(content);
    return () => observer.disconnect();
  }, [place]);

  return { contentRef, onScroll: measureScroll, shadow, tableRef };
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("ui-table-thead", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("ui-table-tbody", className)} {...props} />;
}

/**
 * Things in a row that answer clicks themselves, and the selection cell around
 * its checkbox; a click on them is not a click on the row.
 */
const CONTROLS =
  "a, button, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [role='menuitem'], .ui-table-selection-column";

/** Passes a click on the row to its title link, with the same button and modifier keys. */
function clickTitleLink(event: MouseEvent<HTMLTableRowElement>) {
  const row = event.currentTarget;
  const control = (event.target as Element).closest(CONTROLS);
  if (control !== null && row.contains(control)) return;
  // Dragging across a cell to copy its text is not a click on the row.
  if (window.getSelection()?.toString()) return;
  const link = row.querySelector<HTMLAnchorElement>(
    ':scope > [data-slot="title"] a[href]',
  );
  link?.dispatchEvent(
    new globalThis.MouseEvent(event.type, {
      altKey: event.altKey,
      bubbles: true,
      button: event.button,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }),
  );
}

export function TableRow({
  className,
  clickable,
  ...props
}: ComponentProps<"tr"> & { clickable?: boolean }) {
  return (
    <tr
      className={cn("ui-table-row", className)}
      {...(clickable && {
        "data-clickable": "",
        onAuxClick: (event: MouseEvent<HTMLTableRowElement>) => {
          if (event.button === 1) clickTitleLink(event);
        },
        onClick: clickTitleLink,
      })}
      {...props}
    />
  );
}

type Fixed = "start" | "end";

/** Classes of a cell pinned to one side of a horizontally scrolling table. */
const FIXED = {
  start: "ui-table-cell-fix-start",
  end: "ui-table-cell-fix-end",
} satisfies Record<Fixed, string>;

function fixedClass(fixed: Fixed | undefined) {
  return fixed && ["ui-table-cell-fix", FIXED[fixed]];
}

interface TableHeadProps extends ComponentProps<"th"> {
  fixed?: Fixed;
  numeric?: boolean;
}

export function TableHead({
  className,
  fixed,
  numeric,
  ...props
}: TableHeadProps) {
  return (
    <th
      className={cn(
        "ui-table-cell",
        fixedClass(fixed),
        numeric && "ui-table-cell-numeric",
        className,
      )}
      scope="col"
      {...props}
    />
  );
}

interface TableCellProps extends ComponentProps<"td"> {
  /** The label left of this cell in the card layout, usually the column header's text. */
  cellLabel?: string;
  /**
   * `title` holds the row's name, which heads the card in the card layout;
   * `actions` holds the row's commands, shown on hover or focus and set
   * beside the title in the card layout.
   */
  cellSlot?: "title" | "actions";
  fixed?: Fixed;
  numeric?: boolean;
}

export function TableCell({
  cellLabel,
  cellSlot,
  className,
  fixed,
  numeric,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn(
        "ui-table-cell",
        fixedClass(fixed),
        numeric && "ui-table-cell-numeric",
        className,
      )}
      data-label={cellLabel}
      data-slot={cellSlot}
      {...props}
    />
  );
}

interface SelectionProps {
  checked: boolean;
  fixed?: Fixed;
  onChange: (checked: boolean) => void;
}

/** The header cell of the selection column: selects or clears every row. */
export function TableSelectionHead({
  checked,
  disabled,
  fixed,
  indeterminate,
  onChange,
}: SelectionProps & {
  disabled?: boolean;
  /** Some but not all rows are selected. */
  indeterminate?: boolean;
}) {
  return (
    <th
      className={cn(
        "ui-table-cell ui-table-selection-column",
        fixedClass(fixed),
      )}
      scope="col"
    >
      <Checkbox
        aria-label={m.ui_table_select_all()}
        checked={checked}
        disabled={disabled}
        indeterminate={indeterminate}
        onChange={onChange}
      />
    </th>
  );
}

/** The selection cell of a row, named after it. */
export function TableSelectionCell({
  "aria-label": ariaLabel,
  checked,
  fixed,
  onChange,
}: SelectionProps & { "aria-label": string }) {
  return (
    <td
      className={cn(
        "ui-table-cell ui-table-selection-column",
        fixedClass(fixed),
      )}
    >
      <Checkbox aria-label={ariaLabel} checked={checked} onChange={onChange} />
    </td>
  );
}

/**
 * A column header that opens a menu of commands for the column. It reads in
 * the header's own size and color; the chevron brightens on hover.
 */
export function TableHeadMenu({
  "aria-label": ariaLabel,
  children,
  items,
}: {
  "aria-label": string;
  children: ReactNode;
  items: DropdownItem[];
}) {
  return (
    <DropdownMenu items={items}>
      <button
        aria-label={ariaLabel}
        className="ui-table-head-menu"
        type="button"
      >
        {children}
        <Icon
          className="ui-table-head-menu-icon"
          icon={ChevronDown}
          size={12}
        />
      </button>
    </DropdownMenu>
  );
}
