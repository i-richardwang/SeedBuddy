import { useState } from "react";

import {
  CULTURE_EVENT_REFUSALS,
  CULTURE_EVENT_TYPES,
  type CultureEventsResult,
  type CultureEventType,
} from "../../domain/experiments/culture-events";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { createCultureEvents } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { toast } from "../../ui/kit/Toast";
import { formatList } from "../../ui/lists";
import {
  cultureEventLabel,
  cultureEventRefusalLabel,
  observationLabel,
} from "./labels";
import {
  choiceSelection,
  choiceSize,
  type UnitChoice,
  unlessChanged,
} from "./unit-choice";

const FORM_ID = "record-culture-event";

/**
 * Records the same culture event on one or more units at one observation.
 * Of a choice by treatment, units that cannot take the event that day are
 * passed over, and the toast names them with why.
 */
export function RecordCultureEventDialog({
  experiment,
  choice,
  observations,
  open,
  onClose,
  onDone,
}: {
  experiment: string;
  choice: UnitChoice;
  observations: ExperimentObservation[];
  open: boolean;
  onClose: () => void;
  /** After the event was recorded, or the units chosen were found changed. */
  onDone: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.culture_event_record_units({ count: choiceSize(choice) })}
      okText={m.culture_event_record_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <CultureEventForm
        experiment={experiment}
        choice={choice}
        observations={observations}
        action={action}
        onDone={onDone}
      />
    </FormDialog>
  );
}

/** Proposes contamination at the latest observation; the bar offers the command only once an observation is recorded. */
function CultureEventForm({
  experiment,
  choice,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  choice: UnitChoice;
  observations: ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const [type, setType] = useState<CultureEventType>("contaminated");
  const [observation, setObservation] = useState(observations.at(-1)!.id);

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            unlessChanged(
              createCultureEvents({
                data: {
                  experiment,
                  units: choiceSelection(choice),
                  type,
                  observation,
                },
              }),
            ),
          m.culture_event_not_recorded(),
          {
            onSuccess: (result) => {
              if (result === "changed") {
                toast.error({
                  title: m.culture_event_not_recorded(),
                  description: m.culture_event_units_changed(),
                });
              } else if (!("units" in choice)) {
                reportRecorded(result);
              }
              onDone();
            },
          },
        );
      }}
    >
      <Form.Field label={m.status_label()}>
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

/** What a choice by treatment came to: the units recorded, and those passed over by why. */
function reportRecorded({ recorded, passedOver }: CultureEventsResult) {
  const title = m.culture_event_recorded_count({ count: recorded.length });
  if (passedOver.length === 0) {
    toast.success(title);
    return;
  }
  toast.success({
    title,
    description: CULTURE_EVENT_REFUSALS.map((reason) => {
      const codes = passedOver
        .filter((unit) => unit.reason === reason)
        .map((unit) => unit.code);
      return codes.length === 0 ? null : (
        <span key={reason} className="block">
          {m.culture_event_passed_over({
            reason: cultureEventRefusalLabel(reason),
            units: formatList(codes),
          })}
        </span>
      );
    }),
  });
}
