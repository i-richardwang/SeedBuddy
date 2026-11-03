import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import { Tooltip } from "./Tooltip";

/*
 * An exclusive group of compact toggles; once one is selected, clicking it
 * again keeps it selected. An option's `mark` leads its label, such as the
 * dot of a state or the swatch of a color, and the key that selects it shows
 * on hover (`hotkey`; the caller binds the key). `outlined` is a list's
 * filter: the toggles share one 24px outlined box, parted by hairlines, the
 * selected one on fill.
 *
 * The selected toggle's fill is one indicator that slides to the next
 * selection. Until it has been measured, on the server and in the first
 * client frame, the selected toggle draws the fill itself.
 */

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const place = (group: HTMLElement) => {
  const active = group.querySelector<HTMLElement>(
    ".ui-toggle-group-item[data-pressed]",
  );
  if (!active) {
    delete group.dataset.indicator;
    return;
  }
  const { style } = group;
  style.setProperty("--ui-toggle-group-left", `${active.offsetLeft}px`);
  style.setProperty(
    "--ui-toggle-group-right",
    `${group.clientWidth - active.offsetLeft - active.offsetWidth}px`,
  );
  style.setProperty("--ui-toggle-group-width", `${active.offsetWidth}px`);
  group.dataset.indicator = "";
};

interface ToggleGroupOption<Value extends string> {
  disabled?: boolean;
  /** Written like Hotkey's `keys` (`mod+k`). */
  hotkey?: string;
  label: string;
  mark?: ReactNode;
  value: Value;
}

interface ToggleGroupProps<Value extends string> {
  /** Accessible name of the group. */
  "aria-label": string;
  onChange: (value: Value) => void;
  options: ToggleGroupOption<Value>[];
  /** Nothing is selected while undefined. */
  value: Value | undefined;
  variant?: "ghost" | "outlined";
}

export function ToggleGroup<Value extends string>({
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
  variant = "ghost",
}: ToggleGroupProps<Value>) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Every render may move the selected toggle: another value, another label.
  useIsomorphicLayoutEffect(() => {
    if (groupRef.current) place(groupRef.current);
  });

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const observer = new ResizeObserver(() => place(group));
    observer.observe(group);
    return () => observer.disconnect();
  }, []);

  return (
    <BaseToggleGroup<Value>
      aria-label={ariaLabel}
      className="ui-toggle-group"
      data-variant={variant}
      ref={groupRef}
      value={value === undefined ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked !== undefined && picked !== value) onChange(picked);
      }}
    >
      <span aria-hidden className="ui-toggle-group-indicator" />
      {options.map((option) => (
        <Tooltip hotkey={option.hotkey} key={option.value} placement="bottom">
          <Toggle<Value>
            className="ui-toggle-group-item"
            disabled={option.disabled}
            value={option.value}
          >
            {option.mark}
            {option.label}
          </Toggle>
        </Tooltip>
      ))}
    </BaseToggleGroup>
  );
}
