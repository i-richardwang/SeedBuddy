import type { ModelArea } from "../../domain/models/area";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Switch } from "../../ui/kit/Switch";

/** Whether the task keeps to the dish, as a switch row in a dialog form. */
export function ModelAreaField({
  value,
  onChange,
  disabled,
}: {
  value: ModelArea;
  onChange: (area: ModelArea) => void;
  disabled: boolean;
}) {
  return (
    <Form.Field
      layout="horizontal"
      label={m.model_area_dish_label()}
      desc={m.model_area_dish_description()}
    >
      <Switch
        checked={value === "dish"}
        onChange={(checked) => onChange(checked ? "dish" : "image")}
        disabled={disabled}
      />
    </Form.Field>
  );
}
