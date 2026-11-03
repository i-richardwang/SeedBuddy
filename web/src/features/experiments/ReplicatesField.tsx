import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";

/** How many replicates a treatment is laid out with when nothing says otherwise. */
export const DEFAULT_REPLICATES = 3;

const MAX_REPLICATES = 200;

/** The number of replicates a treatment is laid out in, never below one. */
export function ReplicatesInput({
  disabled,
  value,
  onChange,
  className,
}: {
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <InputNumber
      className={className}
      aria-label={m.treatment_replicates_label()}
      min={1}
      max={MAX_REPLICATES}
      disabled={disabled}
      value={value}
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
    />
  );
}

export function ReplicatesField(props: {
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Form.Field label={m.treatment_replicates_label()}>
      <ReplicatesInput {...props} />
    </Form.Field>
  );
}
