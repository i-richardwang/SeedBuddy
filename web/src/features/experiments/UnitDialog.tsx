import { useState } from "react";

import type { Unit } from "../../domain/experiments/read-model";
import type { Treatment } from "../../domain/experiments/schema";
import { updateUnit } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { TreatmentField } from "./TreatmentField";

const FORM_ID = "edit-unit";

/** Corrects a unit's code or the treatment it replicates; its records stay. */
export function UnitDialog({
  experiment,
  unit,
  treatments,
  open,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.unit_edit()}
      okText={m.save_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <UnitForm
        experiment={experiment}
        unit={unit}
        treatments={treatments}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function UnitForm({
  experiment,
  unit,
  treatments,
  action,
  onDone,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const [code, setCode] = useState(unit.code);
  const [treatment, setTreatment] = useState(unit.treatment);

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() === "") return;
        void action.run(
          () =>
            updateUnit({
              data: { experiment, unit: unit.id, code, treatment },
            }),
          m.unit_not_saved(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <Form.Field label={m.unit_code_label()} required>
        <Input
          autoFocus
          disabled={action.busy}
          value={code}
          onValueChange={setCode}
        />
      </Form.Field>
      <TreatmentField
        disabled={action.busy}
        treatments={treatments}
        value={treatment}
        onChange={setTreatment}
      />
    </Form>
  );
}
