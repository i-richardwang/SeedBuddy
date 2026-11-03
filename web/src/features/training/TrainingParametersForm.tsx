import type {
  TrainingOverrides,
  TrainingParameters,
} from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import { PARAMETER_FIELDS, type ParameterField } from "./parameter-fields";

interface TrainingParametersFormProps {
  parameters: TrainingParameters;
  overrides: TrainingOverrides;
  onChange: (value: TrainingOverrides) => void;
  disabled: boolean;
}

const BASIC_FIELDS = PARAMETER_FIELDS.filter((field) => !field.advanced);
const ADVANCED_FIELDS = PARAMETER_FIELDS.filter((field) => field.advanced);

/** Display resolved values while retaining only the user's adjustments. */
export function TrainingParametersForm(props: TrainingParametersFormProps) {
  return (
    <>
      <ParametersGroup
        {...props}
        title={m.training_parameters_group()}
        fields={BASIC_FIELDS}
      />
      <ParametersGroup
        {...props}
        title={m.training_advanced_parameters()}
        fields={ADVANCED_FIELDS}
        collapsible
      />
    </>
  );
}

/** Fields under one heading, which restores its own fields to the preset's values. */
function ParametersGroup({
  parameters,
  overrides,
  onChange,
  disabled,
  title,
  collapsible,
  fields,
}: TrainingParametersFormProps & {
  title: string;
  collapsible?: boolean;
  fields: ParameterField[];
}) {
  const adjusted = fields.some((field) => overrides[field.key] !== undefined);
  return (
    <Form.Group
      title={title}
      collapsible={collapsible}
      extra={
        adjusted ? (
          <Button
            size="small"
            type="text"
            disabled={disabled}
            onClick={() => {
              const next = { ...overrides };
              for (const field of fields) delete next[field.key];
              onChange(next);
            }}
          >
            {m.training_restore_preset()}
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 mobile:grid-cols-2">
        {fields.map((field) => (
          <Form.Field
            key={field.key}
            label={field.label()}
            desc={field.help?.()}
          >
            <InputNumber
              value={overrides[field.key] ?? parameters[field.key] ?? null}
              placeholder={m.parameter_runtime_default()}
              min={field.min}
              max={field.max}
              step={field.step}
              format={{ maximumFractionDigits: 5 }}
              disabled={disabled}
              onChange={(value) => {
                const next = { ...overrides };
                if (value === null || value === parameters[field.key])
                  delete next[field.key];
                else next[field.key] = value;
                onChange(next);
              }}
            />
          </Form.Field>
        ))}
      </div>
    </Form.Group>
  );
}
