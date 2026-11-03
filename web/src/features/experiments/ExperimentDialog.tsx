import { useState } from "react";

import type { Experiment } from "../../domain/experiments/schema";
import { updateExperiment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

const EDIT_FORM = "edit-experiment";
export function ExperimentDialog({
  experiment,
  open,
  onClose,
}: {
  experiment: Experiment;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.experiment_edit_heading()}
      okText={m.save_action()}
      formId={EDIT_FORM}
      busy={action.busy}
    >
      <EditExperimentForm
        experiment={experiment}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function EditExperimentForm({
  experiment,
  action,
  onDone,
}: {
  experiment: Experiment;
  action: AsyncAction;
  onDone: () => void;
}) {
  const [inoculatedOn, setInoculatedOn] = useState(experiment.inoculatedOn);
  const [countsUnclear, setCountsUnclear] = useState(experiment.countsUnclear);
  return (
    <Form
      id={EDIT_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        const fields = readExperimentFields(new FormData(event.currentTarget));
        void action.run(
          () =>
            updateExperiment({
              data: {
                experiment: experiment.id,
                ...fields,
                inoculatedOn,
                countsUnclear,
              },
            }),
          m.experiment_not_saved(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <ExperimentFields
        disabled={action.busy}
        defaults={experiment}
        inoculatedOn={inoculatedOn}
        onInoculatedOnChange={setInoculatedOn}
        countsUnclear={countsUnclear}
        onCountsUnclearChange={setCountsUnclear}
      />
    </Form>
  );
}
