import { useState } from "react";

import {
  type Treatment,
  treatmentNameSchema,
} from "../../domain/experiments/schema";
import { createTreatment, updateTreatment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { FactorField, factorDraft, submittedFactor } from "./FactorField";
import { DEFAULT_REPLICATES, ReplicatesField } from "./ReplicatesField";

const TREATMENT_FORM = "treatment";

/** Creates a treatment with its replicates, or edits one. */
export function TreatmentDialog({
  experiment,
  treatment,
  open,
  onClose,
}: {
  experiment: string;
  treatment: Treatment | null;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  const creating = treatment === null;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        creating
          ? m.treatment_new()
          : m.treatment_edit({ name: treatment.name })
      }
      okText={creating ? m.add_action() : m.save_action()}
      formId={TREATMENT_FORM}
      busy={action.busy}
    >
      <TreatmentForm
        experiment={experiment}
        treatment={treatment}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function TreatmentForm({
  experiment,
  treatment,
  action,
  onDone,
}: {
  experiment: string;
  treatment: Treatment | null;
  action: AsyncAction;
  onDone: () => void;
}) {
  const [name, setName] = useState(treatment?.name ?? "");
  const [factor, setFactor] = useState(factorDraft(treatment?.factor ?? null));
  const [note, setNote] = useState(treatment?.note ?? "");
  const [replicates, setReplicates] = useState(DEFAULT_REPLICATES);
  const creating = treatment === null;

  return (
    <Form
      id={TREATMENT_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        if (!treatmentNameSchema.safeParse(name).success) return;
        const draft = {
          name: name.trim(),
          factor: submittedFactor(factor),
          note,
        };
        void action.run(
          () =>
            creating
              ? createTreatment({
                  data: { experiment, ...draft, replicates },
                })
              : updateTreatment({
                  data: { experiment, treatment: treatment.id, ...draft },
                }),
          creating ? m.treatment_not_added() : m.treatment_not_saved(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <Form.Field label={m.name_label({ kind: "thing" })} required>
        <Input
          autoFocus
          disabled={action.busy}
          placeholder={m.treatment_name_placeholder()}
          value={name}
          onValueChange={setName}
        />
      </Form.Field>
      <FactorField
        disabled={action.busy}
        factor={factor}
        onChange={setFactor}
      />
      <Form.Field label={m.note_label()}>
        <Input disabled={action.busy} value={note} onValueChange={setNote} />
      </Form.Field>
      {creating ? (
        <ReplicatesField
          disabled={action.busy}
          value={replicates}
          onChange={setReplicates}
        />
      ) : null}
    </Form>
  );
}
