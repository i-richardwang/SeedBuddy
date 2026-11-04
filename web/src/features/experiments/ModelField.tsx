import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { modelName } from "../../ui/model-names";

/** What an observation asks of its photographs: one recognition task. */
export function ModelField({
  disabled,
  models,
  value,
  onChange,
}: {
  disabled: boolean;
  models: readonly Model[];
  value: string;
  onChange: (modelId: string) => void;
}) {
  return (
    <Form.Field label={m.observation_model_label()} required>
      <Select
        disabled={disabled}
        options={models.map((model) => ({
          label: modelName(model),
          value: model.id,
        }))}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
