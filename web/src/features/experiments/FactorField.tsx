import type { TreatmentFactor } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";

const EMPTY_FACTOR: TreatmentFactor = { name: "", level: "", unit: "" };

export function submittedFactor(
  factor: TreatmentFactor,
): TreatmentFactor | null {
  const name = factor.name.trim();
  const level = factor.level.trim();
  const unit = factor.unit.trim();
  if (!name || !level) return null;
  return { name, level, unit };
}

export function FactorField({
  disabled,
  factor,
  onChange,
}: {
  disabled: boolean;
  factor: TreatmentFactor;
  onChange: (factor: TreatmentFactor) => void;
}) {
  return (
    <>
      <Form.Field label={m.treatment_factor_label()}>
        <Input
          disabled={disabled}
          placeholder={m.treatment_factor_placeholder()}
          value={factor.name}
          onValueChange={(name) => onChange({ ...factor, name })}
        />
      </Form.Field>
      <Form.Field label={m.treatment_level_label()}>
        <Input
          disabled={disabled}
          placeholder={m.treatment_level_placeholder()}
          value={factor.level}
          onValueChange={(level) => onChange({ ...factor, level })}
        />
      </Form.Field>
      <Form.Field label={m.treatment_unit_label()}>
        <Input
          disabled={disabled}
          placeholder={m.treatment_unit_placeholder()}
          value={factor.unit}
          onValueChange={(unit) => onChange({ ...factor, unit })}
        />
      </Form.Field>
    </>
  );
}

export function factorDraft(factor: TreatmentFactor | null): TreatmentFactor {
  return factor ?? EMPTY_FACTOR;
}
