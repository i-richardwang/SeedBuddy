import { Collapsible } from "@base-ui/react/collapsible";
import { Field } from "@base-ui/react/field";
import { Fieldset } from "@base-ui/react/fieldset";
import { Form as BaseForm } from "@base-ui/react/form";
import { ChevronRight } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
  useState,
} from "react";

import { cn } from "./cn";
import { Icon } from "./Icon";

/*
 * A native `<form>` built on Base UI Form. Fields are plain controls that carry
 * a `name`; errors reach a field from its own validation, from Zod through
 * `validate`, or from the server through the form's `errors` map, keyed by
 * field name. Fields stack 16px apart, each with its label 8px above the
 * control; with `layout="horizontal"` the label starts the row and the
 * control ends it. `Form.Group` gathers related fields into a section under a
 * heading, folded away when the reader seldom needs them.
 */

interface FormProps extends Omit<BaseForm.Props, "className"> {
  className?: string;
}

function FormRoot({ className, ...rest }: FormProps) {
  return <BaseForm className={cn("ui-form", className)} {...rest} />;
}

/**
 * A label with an optional line of description under it. It is built from
 * phrasing content, so it can sit inside a `<label>`.
 */
function FormTitle({ title, desc }: { desc?: ReactNode; title: ReactNode }) {
  return (
    <span className="ui-form-title">
      <span className="ui-form-title-title">{title}</span>
      {desc && <small className="ui-form-title-desc">{desc}</small>}
    </span>
  );
}

export interface FormFieldProps extends Omit<
  Field.Root.Props,
  "render" | "children" | "className"
> {
  children?: ReactNode;
  className?: string;
  /** A line of description under the label. */
  desc?: ReactNode;
  /** Names a group of controls, such as a CheckboxGroup, with a legend instead of a label. */
  fieldset?: boolean;
  label: ReactNode;
  /** Keeps the label for assistive technology only, for a control whose placeholder and icon name it. */
  labelHidden?: boolean;
  layout?: "horizontal" | "vertical";
  /** Marks the label and passes `required` to the control; a fieldset only marks its legend. */
  required?: boolean;
}

function FormField({
  children,
  className,
  desc,
  fieldset,
  label,
  labelHidden,
  layout = "vertical",
  required,
  ...rest
}: FormFieldProps) {
  const FieldLabel = fieldset ? Fieldset.Legend : Field.Label;

  const control =
    required &&
    !fieldset &&
    isValidElement<{ required?: boolean }>(children) &&
    children.props.required === undefined
      ? cloneElement(children, { required: true })
      : children;

  return (
    <Field.Root
      className={cn(
        "ui-form-field",
        layout === "vertical"
          ? "ui-form-field-vertical"
          : "ui-form-field-horizontal",
        className,
      )}
      render={fieldset ? <Fieldset.Root /> : undefined}
      {...rest}
    >
      <FieldLabel
        className={cn("ui-form-field-label", labelHidden && "sr-only")}
      >
        <FormTitle
          desc={desc}
          title={
            required ? (
              <span>
                <span aria-hidden className="ui-form-field-required">
                  *
                </span>
                {label}
              </span>
            ) : (
              label
            )
          }
        />
      </FieldLabel>
      <div
        className={cn(
          "ui-form-field-control",
          layout === "vertical" && "ui-form-field-control-vertical",
        )}
      >
        {control}
        <Field.Error className="ui-form-field-error" />
      </div>
    </Field.Root>
  );
}

interface FormGroupProps {
  children: ReactNode;
  /** Folds the group closed under its heading, for settings the reader seldom needs. */
  collapsible?: boolean;
  description?: ReactNode;
  /** A small command at the end of the heading, such as restoring a preset's values; a folded group shows it only while open. */
  extra?: ReactNode;
  title: ReactNode;
}

/**
 * A section of a form: related fields under a heading, such as the culture of
 * an experiment or the augmentation settings of a run, with an optional line
 * of description under the heading. Fields inside stack as they do in the form.
 * A collapsible group starts closed; its whole heading opens it, and its
 * description folds away with its fields.
 */
function FormGroup({
  children,
  collapsible,
  description,
  extra,
  title,
}: FormGroupProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const shown = !collapsible || open;

  const naming = {
    "aria-describedby":
      description != null && shown ? descriptionId : undefined,
    "aria-labelledby": titleId,
  };
  const name = <span id={titleId}>{title}</span>;
  const command =
    extra != null && shown ? (
      <span className="ui-form-group-extra">{extra}</span>
    ) : null;
  const content = (
    <>
      {description != null ? (
        <p className="ui-form-group-description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <div className="ui-form-group-body">{children}</div>
    </>
  );

  if (!collapsible) {
    return (
      <fieldset {...naming} className="ui-form-group">
        <legend className="ui-form-group-title">
          <span className="ui-form-group-heading">
            {name}
            {command}
          </span>
        </legend>
        {content}
      </fieldset>
    );
  }

  return (
    <Collapsible.Root
      {...naming}
      className="ui-form-group ui-form-group-collapsible"
      open={open}
      onOpenChange={setOpen}
      render={<fieldset />}
    >
      <legend className="ui-form-group-title">
        <span className="ui-form-group-heading">
          <Collapsible.Trigger className="ui-form-group-trigger">
            {name}
            <Icon
              aria-hidden
              className="ui-form-group-indicator"
              icon={ChevronRight}
              size={16}
            />
          </Collapsible.Trigger>
          {command}
        </span>
      </legend>
      <Collapsible.Panel className="ui-form-group-panel">
        <div className="ui-form-group-panel-content">{content}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export const Form = Object.assign(FormRoot, {
  Field: FormField,
  Group: FormGroup,
});
