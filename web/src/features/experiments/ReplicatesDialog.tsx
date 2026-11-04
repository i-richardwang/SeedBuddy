import { useState } from "react";

import type { Treatment } from "../../domain/experiments/schema";
import { createReplicates } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { ReplicatesField } from "./ReplicatesField";

const FORM_ID = "add-replicates";

/** Lays out more replicates of a treatment, continuing its code series. */
export function ReplicatesDialog({
  experiment,
  treatment,
  open,
  onClose,
}: {
  experiment: string;
  treatment: Treatment;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.treatment_add_replicates({ name: treatment.name })}
      okText={m.add_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ReplicatesForm
        experiment={experiment}
        treatment={treatment}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function ReplicatesForm({
  experiment,
  treatment,
  action,
  onDone,
}: {
  experiment: string;
  treatment: Treatment;
  action: AsyncAction;
  onDone: () => void;
}) {
  const [replicates, setReplicates] = useState(1);
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            createReplicates({
              data: { experiment, treatment: treatment.id, replicates },
            }),
          m.treatment_replicates_not_added(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <ReplicatesField
        disabled={action.busy}
        value={replicates}
        onChange={setReplicates}
      />
    </Form>
  );
}
