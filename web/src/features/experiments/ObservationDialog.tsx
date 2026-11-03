import { useState } from "react";

import type {
  CalendarDay,
  ExperimentObservation,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { updateObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { ObservationFields, type ObservationValue } from "./ObservationFields";

const FORM_ID = "observation";

/** Changes an observation day's date, model, the classes it counts, or note. */
export function ObservationDialog({
  experiment,
  inoculatedOn,
  models,
  observation,
  observations,
  open,
  onClose,
}: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
  observation: ExperimentObservation;
  observations: readonly ExperimentObservation[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.observation_edit()}
      okText={m.save_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <EditObservationForm
        experiment={experiment}
        inoculatedOn={inoculatedOn}
        models={models}
        observation={observation}
        observations={observations}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function EditObservationForm({
  experiment,
  inoculatedOn,
  models,
  observation,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
  observation: ExperimentObservation;
  observations: readonly ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const [value, setValue] = useState<ObservationValue>(() => ({
    observedOn: observation.observedOn,
    modelId: observation.modelId,
    countedClasses: observation.countedClasses,
    note: observation.note,
  }));
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            updateObservation({
              data: { experiment, observation: observation.id, ...value },
            }),
          m.observation_not_saved(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <ObservationFields
        value={value}
        onChange={setValue}
        inoculatedOn={inoculatedOn}
        taken={observations
          .filter((other) => other.id !== observation.id)
          .map((other) => other.observedOn)}
        models={models}
        disabled={action.busy}
      />
    </Form>
  );
}
