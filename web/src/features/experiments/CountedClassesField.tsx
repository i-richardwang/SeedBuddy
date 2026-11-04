import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { CheckboxGroup } from "../../ui/kit/Checkbox";
import { Form } from "../../ui/kit/Form";
import { ClassLabel } from "../annotation/ClassLabel";

/**
 * Which of its model's classes a day counts. A model with one class leaves
 * nothing to choose, and a day always counts at least one, so the last class
 * left checked holds.
 */
export function CountedClassesField({
  disabled,
  model,
  value,
  onChange,
}: {
  disabled: boolean;
  model: Model;
  value: string[];
  onChange: (countedClasses: string[]) => void;
}) {
  if (model.classes.length < 2) return null;
  return (
    <Form.Field
      label={m.observation_counted_classes_label()}
      desc={m.observation_counted_classes_description()}
      required
      fieldset
    >
      <CheckboxGroup
        disabled={disabled}
        value={value}
        options={model.classes.map((name) => ({
          value: name,
          label: <ClassLabel classes={model.classes} name={name} />,
          disabled: value.length === 1 && value[0] === name,
        }))}
        onChange={(next) =>
          onChange(model.classes.filter((name) => next.includes(name)))
        }
      />
    </Form.Field>
  );
}
