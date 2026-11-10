import type { Model } from "../../domain/models/schema";
import { CheckboxGroup } from "../../ui/kit/Checkbox";
import { Form } from "../../ui/kit/Form";
import { ClassLabel } from "../annotation/ClassLabel";

/**
 * Which of a model's classes are counted: by a day, or by every day that
 * does not choose its own. A model with one class leaves nothing to choose,
 * and a count always takes at least one, so the last class left checked
 * holds.
 */
export function CountedClassesField({
  label,
  desc,
  disabled,
  model,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  disabled: boolean;
  model: Pick<Model, "classes">;
  value: string[];
  onChange: (countedClasses: string[]) => void;
}) {
  if (model.classes.length < 2) return null;
  return (
    <Form.Field label={label} desc={desc} required fieldset>
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
