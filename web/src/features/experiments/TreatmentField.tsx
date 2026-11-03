import type { Treatment } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { TreatmentDot } from "./TreatmentDot";

/** One treatment of the design, each shown with its series color. */
export function TreatmentField({
  disabled,
  treatments,
  value,
  onChange,
}: {
  disabled: boolean;
  treatments: readonly Treatment[];
  value: string;
  onChange: (treatment: string) => void;
}) {
  return (
    <Form.Field label={m.experiment_column_treatment()} required>
      <Select
        disabled={disabled}
        options={treatments.map((treatment) => ({
          label: (
            <span className="flex items-center gap-2">
              <TreatmentDot position={treatment.position} />
              {treatment.name}
            </span>
          ),
          title: treatment.name,
          value: treatment.id,
        }))}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
