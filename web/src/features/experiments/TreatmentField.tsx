import type { Treatment } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { TreatmentName } from "./TreatmentName";

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
    <Form.Field label={m.treatment_label()} required>
      <Select
        disabled={disabled}
        options={treatments.map((treatment) => ({
          label: <TreatmentName treatment={treatment} />,
          title: treatment.name,
          value: treatment.id,
        }))}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
