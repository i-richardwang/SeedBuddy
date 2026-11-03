import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { CheckIcon, MinusIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Text } from "./Text";

/*
 * Without children only the box renders. With children a `<label>` wraps box
 * and text; the text names the box even inside a field, whose label names the
 * group.
 */

const MARK = { size: 12, strokeWidth: 3 };

interface CheckboxProps {
  "aria-label"?: string;
  checked?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  /** The value this box contributes inside a CheckboxGroup. */
  value?: string;
}

/** The box itself; named by the text beside it when there is one. */
function CheckboxBox({
  onChange,
  labelledBy,
  ...rest
}: Omit<CheckboxProps, "children"> & { labelledBy?: string }) {
  return (
    <BaseCheckbox.Root
      aria-labelledby={labelledBy}
      className="ui-checkbox"
      onCheckedChange={onChange}
      {...rest}
    >
      <BaseCheckbox.Indicator
        className="ui-checkbox-indicator"
        render={(props, state) => (
          <span {...props}>
            {state.indeterminate ? (
              <MinusIcon {...MARK} />
            ) : (
              <CheckIcon {...MARK} />
            )}
          </span>
        )}
      />
    </BaseCheckbox.Root>
  );
}

export function Checkbox({ children, ...rest }: CheckboxProps) {
  const textId = useId();

  if (!children) return <CheckboxBox {...rest} />;

  return (
    <label className="ui-checkbox-label">
      <CheckboxBox labelledBy={textId} {...rest} />
      <Text as="span" id={textId} disabled={rest.disabled}>
        {children}
      </Text>
    </label>
  );
}

interface CheckboxGroupOption {
  /** Holds the box as it is, such as the last box a group must keep checked. */
  disabled?: boolean;
  label: ReactNode;
  value: string;
}

interface CheckboxGroupProps {
  disabled?: boolean;
  onChange: (value: string[]) => void;
  /** Laid out in a wrapping row. */
  options: CheckboxGroupOption[];
  value: string[];
}

export function CheckboxGroup({
  disabled,
  onChange,
  options,
  value,
}: CheckboxGroupProps) {
  return (
    <BaseCheckboxGroup
      className="ui-checkbox-group"
      disabled={disabled}
      onValueChange={onChange}
      value={value}
    >
      {options.map((item) => (
        <Checkbox key={item.value} value={item.value} disabled={item.disabled}>
          {item.label}
        </Checkbox>
      ))}
    </BaseCheckboxGroup>
  );
}
