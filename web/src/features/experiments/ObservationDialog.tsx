import { useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import { unitIsAvailableOn } from "../../domain/experiments/culture-events";
import type { PlacedPhoto } from "../../domain/experiments/photos";
import {
  type CalendarDay,
  type ExperimentObservation,
  today,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import {
  editObservation,
  recordObservation,
} from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { CountedClassesField } from "./CountedClassesField";
import { DayField } from "./DayField";
import { ModelField } from "./ModelField";
import {
  ObservationPhotosField,
  useObservationPhotos,
} from "./ObservationPhotos";

const FORM_ID = "observation";

/** What a page of the notebook says about a day, apart from its photographs. */
interface ObservationValue {
  observedOn: CalendarDay;
  modelId: string;
  countedClasses: string[];
  note: string;
}

const NO_UNITS: ReadonlySet<string> = new Set();

/**
 * Records an observation day in one step: the date, the model its
 * photographs read for, and the photographs, each matched to its unit.
 */
export function RecordObservationDialog(props: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
  /** The newest observation, whose question a new one asks by default. */
  previous: ExperimentObservation | undefined;
  observations: readonly ExperimentObservation[];
  units: readonly Unit[];
  /** The photographs the experiment already holds. */
  placed: readonly PlacedPhoto[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => (
        <RecordObservationSession {...props} afterClose={afterClose} />
      )}
    </DialogSession>
  );
}

function RecordObservationSession({
  experiment,
  inoculatedOn,
  models,
  previous,
  observations,
  units,
  placed,
  open,
  onClose,
  afterClose,
}: Parameters<typeof RecordObservationDialog>[0] & {
  afterClose: () => void;
}) {
  const action = useAsyncAction();
  const [value, setValue] = useState<ObservationValue>(() => ({
    observedOn: today(),
    modelId: previous?.modelId ?? models[0]!.id,
    countedClasses: previous?.countedClasses ?? models[0]!.classes,
    note: "",
  }));
  const photos = useObservationPhotos({
    units: units.filter((unit) =>
      unitIsAvailableOn(unit.events, value.observedOn, observations),
    ),
    assigned: NO_UNITS,
    placed,
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.observation_record()}
      okText={
        photos.uploads.storing
          ? m.observation_images_uploading()
          : photos.ready.length > 0
            ? m.observation_record_count({ count: photos.ready.length })
            : m.observation_record()
      }
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={photos.pending}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            () =>
              recordObservation({
                data: { experiment, ...value, images: photos.ready },
              }),
            m.observation_not_added(),
            {
              onSuccess: onClose,
            },
          );
        }}
      >
        <ObservationFields
          value={value}
          onChange={setValue}
          inoculatedOn={inoculatedOn}
          taken={observations.map((observation) => observation.observedOn)}
          models={models}
          disabled={action.busy}
        />
        <ObservationPhotosField photos={photos} disabled={action.busy} />
      </Form>
    </FormDialog>
  );
}

/** Changes an observation day's date, model, the classes it counts, or note. */
export function EditObservationDialog({
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
      okText={m.experiment_action_save()}
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
        onClose={onClose}
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
  onClose,
}: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
  observation: ExperimentObservation;
  observations: readonly ExperimentObservation[];
  action: AsyncAction;
  onClose: () => void;
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
            editObservation({
              data: { experiment, observation: observation.id, ...value },
            }),
          m.observation_not_saved(),
          {
            onSuccess: onClose,
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

function ObservationFields({
  value,
  onChange,
  inoculatedOn,
  taken,
  models,
  disabled,
}: {
  value: ObservationValue;
  onChange: (value: ObservationValue) => void;
  inoculatedOn: CalendarDay;
  /** The days other observations already hold. */
  taken: readonly CalendarDay[];
  models: readonly Model[];
  disabled: boolean;
}) {
  const modelOf = (id: string) => models.find((model) => model.id === id)!;
  return (
    <>
      <DayField
        label={m.observation_date_label()}
        disabled={disabled}
        value={value.observedOn}
        earliest={{
          day: inoculatedOn,
          error: m.observation_before_inoculation(),
        }}
        taken={{ days: taken, error: m.observation_day_taken() }}
        onChange={(observedOn) => onChange({ ...value, observedOn })}
      />
      <ModelField
        disabled={disabled}
        models={models}
        value={value.modelId}
        // Another model recognizes other classes, so the day counts all of them
        // until told otherwise.
        onChange={(modelId) =>
          onChange({
            ...value,
            modelId,
            countedClasses: modelOf(modelId).classes,
          })
        }
      />
      <CountedClassesField
        disabled={disabled}
        model={modelOf(value.modelId)}
        value={value.countedClasses}
        onChange={(countedClasses) => onChange({ ...value, countedClasses })}
      />
      <Form.Field label={m.observation_note_label()}>
        <Input
          disabled={disabled}
          value={value.note}
          onValueChange={(note) => onChange({ ...value, note })}
        />
      </Form.Field>
    </>
  );
}
