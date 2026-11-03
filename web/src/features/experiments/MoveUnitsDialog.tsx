import { useState } from "react";

import type { Unit } from "../../domain/experiments/read-model";
import type { Treatment } from "../../domain/experiments/schema";
import { updateUnitsTreatment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { TreatmentField } from "./TreatmentField";

const FORM_ID = "move-units";

/** Moves the selected units to one treatment; each keeps its code. */
export function MoveUnitsDialog({
  experiment,
  units,
  treatments,
  open,
  onClose,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.experiment_move_units()}
      okText={m.experiment_action_save()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={units.length === 0}
    >
      <MoveForm
        experiment={experiment}
        units={units}
        treatments={treatments}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

/** Proposes a treatment the units are not all in already. */
function MoveForm({
  experiment,
  units,
  treatments,
  action,
  onDone,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const shared = units.every((unit) => unit.treatment === units[0]?.treatment)
    ? units[0]?.treatment
    : undefined;
  const [treatment, setTreatment] = useState(
    () =>
      treatments.find((item) => item.id !== shared)?.id ??
      treatments[0]?.id ??
      "",
  );

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        if (treatment === "" || units.length === 0) return;
        void action.run(
          () =>
            updateUnitsTreatment({
              data: {
                experiment,
                units: units.map((unit) => unit.id),
                treatment,
              },
            }),
          m.experiment_units_not_moved(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <TreatmentField
        disabled={action.busy}
        treatments={treatments}
        value={treatment}
        onChange={setTreatment}
      />
    </Form>
  );
}
