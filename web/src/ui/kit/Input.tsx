import { Field } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { NumberField } from "@base-ui/react/number-field";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useState,
} from "react";

import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import { Icon } from "./Icon";

/*
 * Text, multiline, password and number fields share one shell. The shell is
 * outlined in the light scheme and filled in the dark one; CSS picks it from
 * `.dark`, so rendering never reads the theme.
 */

type InputSize = "small" | "middle" | "large";

const SIZE = {
  large: "ui-input-size-large",
  middle: "ui-input-size-middle",
  small: "ui-input-size-small",
} as const;

/** Class names of the field shell, also worn by DatePicker's field. */
export const shellClass = (size?: InputSize) =>
  cn("ui-input", size && SIZE[size]);

interface InputProps extends Omit<
  BaseInput.Props,
  "size" | "prefix" | "render" | "className" | "style"
> {
  className?: string;
  prefix?: ReactNode;
  size?: InputSize;
  suffix?: ReactNode;
}

export function Input({
  className,
  disabled,
  prefix,
  size = "middle",
  suffix,
  ...props
}: InputProps) {
  return (
    <div
      className={cn(shellClass(size), className)}
      data-disabled={disabled ? "" : undefined}
    >
      {prefix && <span className="ui-input-slot">{prefix}</span>}
      <BaseInput className="ui-input-input" disabled={disabled} {...props} />
      {suffix && <span className="ui-input-slot">{suffix}</span>}
    </div>
  );
}

/** A password field with an eye button that reveals the password. */
export function InputPassword(props: Omit<InputProps, "type" | "suffix">) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      type={visible ? "text" : "password"}
      suffix={
        <button
          aria-label={
            visible ? m.ui_input_hide_password() : m.ui_input_show_password()
          }
          className="ui-input-password-toggle"
          tabIndex={-1}
          type="button"
          onClick={() => setVisible((v) => !v)}
        >
          <Icon icon={visible ? Eye : EyeOff} size={16} />
        </button>
      }
      {...props}
    />
  );
}

interface TextAreaProps extends Omit<
  ComponentProps<"textarea">,
  "prefix" | "style"
> {
  /** Grows with the content between `minRows` and `maxRows`. */
  autoSize?: { maxRows?: number; minRows?: number };
}

export function TextArea({
  autoSize,
  className,
  disabled,
  ...props
}: TextAreaProps) {
  const bounds = autoSize
    ? {
        "--ui-textarea-max-height": autoSize.maxRows
          ? `calc(1.5em * ${autoSize.maxRows})`
          : undefined,
        "--ui-textarea-min-rows": autoSize.minRows,
      }
    : undefined;
  return (
    <div
      className={cn(
        shellClass(),
        "ui-input-textarea",
        autoSize && "ui-input-textarea-auto-size",
        className,
      )}
      data-disabled={disabled ? "" : undefined}
      style={bounds as CSSProperties | undefined}
    >
      <Field.Control
        className="ui-input-input"
        disabled={disabled}
        render={<textarea {...props} />}
      />
    </div>
  );
}

interface InputNumberProps extends Omit<
  NumberField.Root.Props,
  "className" | "style" | "render" | "onValueChange" | "children" | "ref"
> {
  className?: string;
  onChange: (value: number | null) => void;
  /** Stands in the field while it is empty, such as what an empty value falls back to. */
  placeholder?: string;
}

/** A number field with increment and decrement buttons. */
export function InputNumber({
  "aria-label": ariaLabel,
  className,
  onChange,
  placeholder,
  ...props
}: InputNumberProps) {
  return (
    <NumberField.Root
      className={cn(shellClass("middle"), className)}
      onValueChange={onChange}
      {...props}
    >
      <NumberField.Input
        aria-label={ariaLabel}
        className="ui-input-input ui-input-number-input"
        placeholder={placeholder}
      />
      <div className="ui-input-number-controls">
        <NumberField.Increment
          aria-label={m.ui_input_number_increase()}
          className="ui-input-number-control"
        >
          <Icon icon={ChevronUp} size={12} />
        </NumberField.Increment>
        <NumberField.Decrement
          aria-label={m.ui_input_number_decrease()}
          className="ui-input-number-control"
        >
          <Icon icon={ChevronDown} size={12} />
        </NumberField.Decrement>
      </div>
    </NumberField.Root>
  );
}
