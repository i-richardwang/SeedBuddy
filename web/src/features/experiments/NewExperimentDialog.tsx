import { useState } from "react";

import { today } from "../../domain/experiments/schema";
import { createExperiment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { Form } from "../../ui/kit/Form";
import {
  DesignField,
  type DesignRow,
  initialDesign,
  submittedDesign,
} from "./DesignField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

const FORM_ID = "new-experiment";

interface NewExperimentDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Starts an experiment from its notebook page and its design, then opens it. */
export function NewExperimentDialog(props: NewExperimentDialogProps) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => (
        <NewExperimentSession {...props} afterClose={afterClose} />
      )}
    </DialogSession>
  );
}

function NewExperimentSession({
  open,
  onClose,
  afterClose,
}: NewExperimentDialogProps & { afterClose: () => void }) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const action = useAsyncAction();
  const [inoculatedOn, setInoculatedOn] = useState(today);
  const [countsUnclear, setCountsUnclear] = useState(false);
  const [design, setDesign] = useState<DesignRow[]>(initialDesign);
  const treatments = submittedDesign(design);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.experiment_new()}
      okText={m.experiment_start()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={treatments.length === 0}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          if (treatments.length === 0) return;
          const form = new FormData(event.currentTarget);
          void action.run(
            () =>
              createExperiment({
                data: {
                  ...readExperimentFields(form),
                  inoculatedOn,
                  countsUnclear,
                  treatments,
                },
              }),
            m.experiment_not_started(),
            {
              invalidate: false,
              onSuccess: async (experiment) => {
                onClose();
                await navigateAfterWrite({
                  to: "/experiments/$experiment",
                  params: { experiment: experiment.id },
                });
              },
            },
          );
        }}
      >
        <ExperimentFields
          disabled={action.busy}
          inoculatedOn={inoculatedOn}
          onInoculatedOnChange={setInoculatedOn}
          countsUnclear={countsUnclear}
          onCountsUnclearChange={setCountsUnclear}
        />
        <DesignField
          disabled={action.busy}
          rows={design}
          onChange={setDesign}
        />
      </Form>
    </FormDialog>
  );
}
