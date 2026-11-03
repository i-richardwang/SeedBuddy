import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown, X } from "lucide-react";
import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react";

import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import { defaultPortalContainer } from "./floating";
import { Hotkey } from "./Hotkey";
import { Icon } from "./Icon";

/*
 * A controlled select of one value from a flat list of options. Without a
 * `variant` the trigger is outlined in the light scheme and filled in the dark
 * one; CSS picks it from `.dark`. The popup reuses the menu blocks from
 * DropdownMenu.css. An option's label is also what the trigger shows for it.
 */

export type SelectSize = "middle" | "small";
export type SelectVariant = "borderless" | "filled";

export interface SelectOption<Value = string> {
  disabled?: boolean;
  /** A shortcut that picks this option elsewhere, shown at the end of its row. */
  hotkey?: string;
  label: ReactNode;
  value: Value;
}

interface SelectBaseProps<Value> {
  /** Accessible name of the trigger when no visible label is associated with it. */
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  options: SelectOption<Value>[];
  placeholder?: ReactNode;
  /** `content` lets the popup grow past the trigger's width to fit its options. */
  popupWidth?: "trigger" | "content";
  size?: SelectSize;
  variant?: SelectVariant;
}

/**
 * With `allowClear`, Backspace or Delete on the trigger empties the value and
 * `onChange` receives `null`; the clear glyph does the same for a pointer.
 */
export type SelectProps<Value = string> = SelectBaseProps<Value> &
  (
    | { allowClear?: false; onChange: (value: Value) => void; value: Value }
    | {
        allowClear: true;
        onChange: (value: Value | null) => void;
        value: Value | null;
      }
  );

const TRIGGER_SIZE = {
  middle: "ui-select-trigger-middle",
  small: "ui-select-trigger-small",
} as const;

const TRIGGER_VARIANT = {
  borderless: "ui-select-borderless",
  filled: "ui-select-filled",
} as const;

const searchText = <Value,>(option: SelectOption<Value>) =>
  typeof option.label === "string" || typeof option.label === "number"
    ? String(option.label)
    : String(option.value);

export function Select<Value = string>(props: SelectProps<Value>) {
  const {
    "aria-label": ariaLabel,
    className,
    disabled,
    id,
    options,
    placeholder,
    popupWidth = "trigger",
    size = "middle",
    value,
    variant,
  } = props;

  const emit = (next: Value | null) => {
    if (props.allowClear) props.onChange(next);
    else if (next !== null) props.onChange(next);
  };

  const optionOf = (optionValue: Value): SelectOption<Value> =>
    options.find((option) => Object.is(option.value, optionValue)) ?? {
      label: String(optionValue),
      value: optionValue,
    };

  const renderValue = (current: Value | null): ReactNode => {
    if (current === null)
      return placeholder === undefined ? null : (
        <span className="ui-select-value-text">{placeholder}</span>
      );
    return (
      <span className="ui-select-value-text">{optionOf(current).label}</span>
    );
  };

  const showClear = props.allowClear && value !== null && !disabled;

  /* The glyph sits inside the trigger, so its pointer events stop here and never open the popup. */
  const holdPointer = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const clearByKey = (event: KeyboardEvent) => {
    if (showClear && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      emit(null);
    }
  };

  return (
    <BaseSelect.Root<Value>
      disabled={disabled}
      id={id}
      modal={false}
      value={value}
      onValueChange={emit}
    >
      <BaseSelect.Trigger
        aria-keyshortcuts={showClear ? "Backspace Delete" : undefined}
        aria-label={ariaLabel}
        className={cn(
          "ui-select-trigger",
          TRIGGER_SIZE[size],
          variant ? TRIGGER_VARIANT[variant] : "ui-select-auto",
          className,
        )}
        disabled={disabled}
        onKeyDown={clearByKey}
      >
        <BaseSelect.Value className="ui-select-value">
          {renderValue}
        </BaseSelect.Value>
        <span className="ui-select-suffix">
          {showClear && (
            <span
              aria-hidden
              className="ui-select-clear"
              onClick={(event) => {
                holdPointer(event);
                emit(null);
              }}
              onMouseDown={holdPointer}
              onPointerDown={holdPointer}
            >
              <Icon icon={X} size={14} />
            </span>
          )}
          <BaseSelect.Icon className="ui-select-icon">
            <Icon
              icon={ChevronDown}
              size={14}
              style={{ pointerEvents: "none" }}
            />
          </BaseSelect.Icon>
        </span>
      </BaseSelect.Trigger>

      <BaseSelect.Portal container={defaultPortalContainer()}>
        <BaseSelect.Positioner
          align="start"
          alignItemWithTrigger={false}
          className="ui-select-positioner"
          side="bottom"
          sideOffset={6}
        >
          <BaseSelect.Popup
            className={cn(
              "ui-dropdown-menu-popup",
              "ui-select-popup",
              popupWidth === "content" && "ui-select-popup-fit-content",
            )}
          >
            <BaseSelect.List className="ui-select-list">
              {options.length === 0 ? (
                <div className="ui-dropdown-menu-item ui-dropdown-menu-empty">
                  {m.ui_no_data()}
                </div>
              ) : (
                options.map((option) => (
                  <BaseSelect.Item
                    className="ui-dropdown-menu-item"
                    disabled={option.disabled}
                    key={String(option.value)}
                    label={searchText(option)}
                    value={option.value}
                  >
                    <BaseSelect.ItemText className="ui-dropdown-menu-label">
                      {option.label}
                    </BaseSelect.ItemText>
                    {option.hotkey && (
                      <span className="ui-select-item-hotkey">
                        <Hotkey keys={option.hotkey} />
                      </span>
                    )}
                    <BaseSelect.ItemIndicator className="ui-select-item-indicator">
                      <Icon icon={Check} size={14} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))
              )}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
