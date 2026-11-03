import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import {
  CULTURE_EVENT_TYPES,
  type CultureEventType,
  type ExperimentObservation,
} from "../../domain/experiments/schema";
import { createCultureEvents } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { cultureEventLabel, observationLabel } from "./labels";

const FORM_ID = "record-culture-event";

/** Records the same culture event on one or more units at one observation. */
export function RecordCultureEventDialog({
  experiment,
  units,
  observations,
  open,
  onClose,
}: {
  experiment: string;
  units: Unit[];
  observations: ExperimentObservation[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.culture_event_record()}
      okText={m.culture_event_record_action()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={units.length === 0 || observations.length === 0}
    >
      <CultureEventForm
        experiment={experiment}
        units={units}
        observations={observations}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

/** Proposes contamination at the latest observation. */
function CultureEventForm({
  experiment,
  units,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  units: Unit[];
  observations: ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<CultureEventType>("contaminated");
  const [observation, setObservation] = useState(observations.at(-1)?.id ?? "");

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        if (observation === "" || units.length === 0) return;
        void action.run(
          () =>
            createCultureEvents({
              data: {
                experiment,
                units: units.map((unit) => unit.id),
                type,
                observation,
              },
            }),
          m.culture_event_not_recorded(),
          {
            onSuccess: onDone,
            invalidate: () => router.invalidate(),
          },
        );
      }}
    >
      <Form.Field label={m.culture_event_label()}>
        <Select
          disabled={action.busy}
          options={CULTURE_EVENT_TYPES.map((value) => ({
            label: cultureEventLabel(value),
            value,
          }))}
          value={type}
          onChange={setType}
        />
      </Form.Field>
      <Form.Field label={m.observation_label()}>
        <Select
          disabled={action.busy}
          options={observations.map((item) => ({
            label: observationLabel(item),
            value: item.id,
          }))}
          value={observation}
          onChange={setObservation}
        />
      </Form.Field>
    </Form>
  );
}
