import { Field } from "@base-ui/react/field";
import { Popover as BasePopover } from "@base-ui/react/popover";
import {
  type CalendarDate,
  type DateDuration,
  endOfWeek,
  getLocalTimeZone,
  isSameDay,
  parseDate,
  startOfMonth,
  startOfWeek,
  today,
} from "@internationalized/date";
import { CalendarIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type { CalendarDay } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { Button } from "./Button";
import { cn } from "./cn";
import { defaultPortalContainer } from "./floating";
import { Icon } from "./Icon";
import { shellClass } from "./Input";

/*
 * A controlled single-day picker that always holds a day. The field shows the
 * day formatted for the active locale; pressing it opens a dialog with three
 * views: days of a month, months of a year, years of a decade. The header's
 * month and year buttons switch to the coarser views; picking a year leads
 * to its months, picking a month to its days.
 *
 * Each view is an ARIA grid with one tab stop. Arrows move by a cell (a
 * day, or a row of a week / three months / three years); PageUp and
 * PageDown step the view like its innermost header arrows, Shift like its
 * outermost; Home and End go to the start and end of the row; Enter and
 * Space pick. The grid follows the keyboard into neighboring months.
 *
 * The trigger is the control of an enclosing Base UI Field: the field's
 * label names it, and the field's invalid state and errors apply to it.
 *
 * The field is the Input shell, so it looks and responds like the text
 * fields beside it. Today is read only inside the open dialog, which renders
 * only in the browser.
 */

interface DatePickerProps {
  disabled?: boolean;
  /** The earliest day that can be picked. */
  earliest?: CalendarDay;
  onChange: (day: CalendarDay) => void;
  value: CalendarDay;
}

type View = "day" | "month" | "year";

interface Step {
  duration: DateDuration;
  next: () => string;
  previous: () => string;
}

/** How far each view's header arrows move it, outermost first. */
const STEPS: Record<View, Step[]> = {
  day: [
    {
      duration: { years: 1 },
      next: m.ui_date_picker_next_year,
      previous: m.ui_date_picker_prev_year,
    },
    {
      duration: { months: 1 },
      next: m.ui_date_picker_next_month,
      previous: m.ui_date_picker_prev_month,
    },
  ],
  month: [
    {
      duration: { years: 1 },
      next: m.ui_date_picker_next_year,
      previous: m.ui_date_picker_prev_year,
    },
  ],
  year: [
    {
      duration: { years: 10 },
      next: m.ui_date_picker_next_decade,
      previous: m.ui_date_picker_prev_decade,
    },
  ],
};

function pageStep(view: View, outermost: boolean): DateDuration {
  const steps = STEPS[view];
  return steps[outermost ? 0 : steps.length - 1]!.duration;
}

const FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeZone: "UTC",
};

export function DatePicker({
  disabled = false,
  earliest,
  onChange,
  value,
}: DatePickerProps) {
  const locale = getLocale();
  const [open, setOpenState] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const date = parseDate(value);
  const earliestDate = earliest === undefined ? undefined : parseDate(earliest);

  const setOpen = (next: boolean) => {
    if (disabled && next) return;
    setOpenState(next);
  };
  const isDisabled = (candidate: CalendarDate) =>
    earliestDate !== undefined && candidate.compare(earliestDate) < 0;
  // Formatted in UTC so the runtime's time zone cannot move the day.
  const text = new Intl.DateTimeFormat(locale, FORMAT).format(
    date.toDate("UTC"),
  );
  const openFromField = (event: MouseEvent<HTMLDivElement>) => {
    if (triggerRef.current?.contains(event.target as Node)) return;
    triggerRef.current?.focus();
    setOpen(true);
  };

  return (
    <BasePopover.Root onOpenChange={setOpen} open={open}>
      <div
        className={cn(shellClass("middle"), "ui-date-picker")}
        data-disabled={disabled ? "" : undefined}
        // A press on the padding or the suffix opens the dialog like a press on the text.
        onClick={openFromField}
        ref={setAnchor}
      >
        <BasePopover.Trigger
          className="ui-input-input ui-date-picker-trigger"
          disabled={disabled}
          ref={triggerRef}
          render={
            <Field.Control
              disabled={disabled}
              render={<button type="button" />}
              value={value}
            />
          }
        >
          {text}
        </BasePopover.Trigger>
        <span className="ui-input-slot">
          <Icon icon={CalendarIcon} />
        </span>
      </div>
      <BasePopover.Portal container={defaultPortalContainer()}>
        <BasePopover.Positioner
          align="start"
          anchor={anchor}
          className="ui-date-picker-positioner"
          side="bottom"
          sideOffset={4}
        >
          <BasePopover.Popup
            aria-label={m.ui_date_picker_dialog()}
            className="ui-date-picker-popup"
            finalFocus={triggerRef}
            initialFocus={false}
          >
            <Calendar
              isDisabled={isDisabled}
              locale={locale}
              onPick={(picked) => {
                onChange(picked.toString());
                setOpen(false);
              }}
              value={date}
            />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

function Calendar({
  isDisabled,
  locale,
  onPick,
  value,
}: {
  isDisabled: (date: CalendarDate) => boolean;
  locale: string;
  onPick: (date: CalendarDate) => void;
  value: CalendarDate;
}) {
  const now = today(getLocalTimeZone());
  const [view, setView] = useState<View>("day");
  const [focused, setFocused] = useState(value);
  const focusedCell = useRef<HTMLTableCellElement>(null);
  // Focus follows the keyboard position after every move, and lands on it when the dialog opens.
  const focusPending = useRef(true);
  const labelId = useId();

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    focusedCell.current?.focus({ preventScroll: true });
  }, [focused, view]);

  const moveTo = (date: CalendarDate) => {
    focusPending.current = true;
    setFocused(date);
  };
  const showView = (next: View, date = focused) => {
    focusPending.current = true;
    setFocused(date);
    setView(next);
  };

  const yearFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    timeZone: "UTC",
  });
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  // Locales differ in whether the month or the year comes first.
  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
  }).formatToParts(new Date(Date.UTC(2000, 0, 15)));
  const monthFirst =
    parts.findIndex((part) => part.type === "month") <
    parts.findIndex((part) => part.type === "year");

  const decadeStart = Math.floor(focused.year / 10) * 10;
  const yearButton = (
    <button
      aria-label={m.ui_date_picker_choose_year()}
      key="year"
      onClick={() => showView("year")}
      type="button"
    >
      {yearFormat.format(focused.toDate("UTC"))}
    </button>
  );
  const monthButton = (
    <button
      aria-label={m.ui_date_picker_choose_month()}
      key="month"
      onClick={() => showView("month")}
      type="button"
    >
      {monthFormat.format(focused.toDate("UTC"))}
    </button>
  );
  const title =
    view === "day"
      ? monthFirst
        ? [monthButton, yearButton]
        : [yearButton, monthButton]
      : view === "month"
        ? yearButton
        : m.ui_date_picker_decade({
            first: String(decadeStart),
            last: String(decadeStart + 9),
          });

  return (
    <>
      <Header
        labelId={labelId}
        onStep={(duration, direction) =>
          setFocused(
            direction === 1
              ? focused.add(duration)
              : focused.subtract(duration),
          )
        }
        steps={STEPS[view]}
      >
        {title}
      </Header>
      <div
        className={
          view === "day"
            ? "ui-date-picker-body-day"
            : "ui-date-picker-body-coarse"
        }
      >
        {view === "day" ? (
          <DateGrid
            focused={focused}
            focusedCell={focusedCell}
            isDisabled={isDisabled}
            labelId={labelId}
            locale={locale}
            moveTo={moveTo}
            now={now}
            onPick={onPick}
            value={value}
          />
        ) : view === "month" ? (
          <CoarseGrid
            cells={Array.from({ length: 12 }, (_, index) =>
              focused.set({ month: index + 1 }),
            )}
            focused={focused}
            focusedCell={focusedCell}
            format={(date) =>
              monthFormat.format(date.set({ day: 1 }).toDate("UTC"))
            }
            inView={() => true}
            isCurrent={(date) =>
              date.year === now.year && date.month === now.month
            }
            isSelected={(date) =>
              date.year === value.year && date.month === value.month
            }
            labelId={labelId}
            moveTo={moveTo}
            onPick={(date) => showView("day", date)}
            view="month"
          />
        ) : (
          <CoarseGrid
            cells={Array.from({ length: 12 }, (_, index) =>
              focused.set({ year: decadeStart - 1 + index }),
            )}
            focused={focused}
            focusedCell={focusedCell}
            format={(date) =>
              yearFormat.format(date.set({ day: 1 }).toDate("UTC"))
            }
            inView={(date) =>
              date.year >= decadeStart && date.year <= decadeStart + 9
            }
            isCurrent={(date) => date.year === now.year}
            isSelected={(date) => date.year === value.year}
            labelId={labelId}
            moveTo={moveTo}
            onPick={(date) => showView("month", date)}
            view="year"
          />
        )}
      </div>
      {view === "day" && (
        <div className="ui-date-picker-footer">
          <Button
            disabled={isDisabled(now)}
            onClick={() => onPick(now)}
            size="small"
            type="text"
          >
            {m.ui_date_picker_today()}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The view's title between its step arrows: previous arrows on the leading
 * side, outermost first, and next arrows mirrored on the trailing side. The
 * outermost arrow is drawn double.
 */
function Header({
  children,
  labelId,
  onStep,
  steps,
}: {
  children: ReactNode;
  labelId: string;
  onStep: (duration: DateDuration, direction: 1 | -1) => void;
  steps: Step[];
}) {
  const arrow = (step: Step, index: number, direction: 1 | -1) => (
    <button
      aria-label={direction === 1 ? step.next() : step.previous()}
      className="ui-date-picker-step"
      key={index}
      onClick={() => onStep(step.duration, direction)}
      tabIndex={-1}
      type="button"
    >
      <span
        className={cn(
          "ui-date-picker-arrow",
          index === 0 && "ui-date-picker-arrow-double",
          direction === 1 && "ui-date-picker-arrow-next",
        )}
      />
    </button>
  );
  return (
    <div className="ui-date-picker-header">
      {steps.map((step, index) => arrow(step, index, -1))}
      <div aria-live="polite" className="ui-date-picker-title" id={labelId}>
        {children}
      </div>
      {steps.map((step, index) => arrow(step, index, 1)).reverse()}
    </div>
  );
}

function cellClass({
  current,
  disabled,
  inView,
  selected,
}: {
  current: boolean;
  disabled: boolean;
  inView: boolean;
  selected: boolean;
}) {
  return cn(
    "ui-date-picker-cell",
    inView && "ui-date-picker-cell-in-view",
    current && "ui-date-picker-cell-current",
    selected && "ui-date-picker-cell-selected",
    disabled && "ui-date-picker-cell-disabled",
  );
}

function DateGrid({
  focused,
  focusedCell,
  isDisabled,
  labelId,
  locale,
  moveTo,
  now,
  onPick,
  value,
}: {
  focused: CalendarDate;
  focusedCell: RefObject<HTMLTableCellElement | null>;
  isDisabled: (date: CalendarDate) => boolean;
  labelId: string;
  locale: string;
  moveTo: (date: CalendarDate) => void;
  now: CalendarDate;
  onPick: (date: CalendarDate) => void;
  value: CalendarDate;
}) {
  // Six weeks always, so the view keeps its height from month to month.
  const first = startOfWeek(startOfMonth(focused), locale);
  const days = Array.from({ length: 42 }, (_, index) =>
    first.add({ days: index }),
  );
  const weeks = Array.from({ length: 6 }, (_, row) =>
    days.slice(row * 7, row * 7 + 7),
  );
  const weekdayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const weekdayLongFormat = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
  const fullFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "UTC",
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const page = pageStep("day", event.shiftKey);
    const moves: Record<string, () => CalendarDate> = {
      ArrowLeft: () => focused.subtract({ days: 1 }),
      ArrowRight: () => focused.add({ days: 1 }),
      ArrowUp: () => focused.subtract({ weeks: 1 }),
      ArrowDown: () => focused.add({ weeks: 1 }),
      PageUp: () => focused.subtract(page),
      PageDown: () => focused.add(page),
      Home: () => startOfWeek(focused, locale),
      End: () => endOfWeek(focused, locale),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveTo(move());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isDisabled(focused)) onPick(focused);
    }
  };

  return (
    <table
      aria-labelledby={labelId}
      className="ui-date-picker-grid"
      onKeyDown={onKeyDown}
      role="grid"
    >
      <thead>
        <tr>
          {weeks[0]!.map((day) => (
            <th
              abbr={weekdayLongFormat.format(day.toDate("UTC"))}
              key={day.toString()}
              scope="col"
            >
              {weekdayFormat.format(day.toDate("UTC"))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]!.toString()}>
            {week.map((day) => {
              const isFocused = isSameDay(day, focused);
              const disabled = isDisabled(day);
              const selected = isSameDay(day, value);
              const current = isSameDay(day, now);
              return (
                <td
                  aria-current={current ? "date" : undefined}
                  aria-disabled={disabled || undefined}
                  aria-label={fullFormat.format(day.toDate("UTC"))}
                  aria-selected={selected}
                  className={cellClass({
                    current,
                    disabled,
                    inView: day.month === focused.month,
                    selected,
                  })}
                  key={day.toString()}
                  onClick={() => {
                    if (disabled) return;
                    onPick(day);
                  }}
                  ref={isFocused ? focusedCell : undefined}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                >
                  <div className="ui-date-picker-cell-inner">{day.day}</div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CELL_UNIT = { month: "months", year: "years" } as const;

/** Twelve months of a year, or the years of a decade with one on each side, three to a row. */
function CoarseGrid({
  cells,
  focused,
  focusedCell,
  format,
  inView,
  isCurrent,
  isSelected,
  labelId,
  moveTo,
  onPick,
  view,
}: {
  cells: CalendarDate[];
  focused: CalendarDate;
  focusedCell: RefObject<HTMLTableCellElement | null>;
  format: (date: CalendarDate) => string;
  inView: (date: CalendarDate) => boolean;
  isCurrent: (date: CalendarDate) => boolean;
  isSelected: (date: CalendarDate) => boolean;
  labelId: string;
  moveTo: (date: CalendarDate) => void;
  onPick: (date: CalendarDate) => void;
  view: "month" | "year";
}) {
  const columns = 3;
  const rows = Array.from({ length: cells.length / columns }, (_, row) =>
    cells.slice(row * columns, row * columns + columns),
  );
  const column = cells.findIndex((cell) => isSameDay(cell, focused)) % columns;
  const step = (cellCount: number) =>
    focused.add({ [CELL_UNIT[view]]: cellCount });

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const page = pageStep(view, event.shiftKey);
    const moves: Record<string, () => CalendarDate> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      ArrowUp: () => step(-columns),
      ArrowDown: () => step(columns),
      PageUp: () => focused.subtract(page),
      PageDown: () => focused.add(page),
      Home: () => step(-column),
      End: () => step(columns - 1 - column),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveTo(move());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(focused);
    }
  };

  return (
    <table
      aria-labelledby={labelId}
      className="ui-date-picker-grid"
      onKeyDown={onKeyDown}
      role="grid"
    >
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]!.toString()}>
            {row.map((cell) => {
              const isFocused = isSameDay(cell, focused);
              const selected = isSelected(cell);
              return (
                <td
                  aria-selected={selected}
                  className={cellClass({
                    current: isCurrent(cell),
                    disabled: false,
                    inView: inView(cell),
                    selected,
                  })}
                  key={cell.toString()}
                  onClick={() => onPick(cell)}
                  ref={isFocused ? focusedCell : undefined}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                >
                  <div className="ui-date-picker-cell-inner">
                    {format(cell)}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
