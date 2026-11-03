import { useState } from "react";

import { unitIsAvailableOn } from "../../domain/experiments/culture-events";
import type { PlacedPhoto } from "../../domain/experiments/photos";
import type { Unit } from "../../domain/experiments/read-model";
import {
  type CalendarDay,
  type ExperimentObservation,
  today,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { createObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { ObservationFields, type ObservationValue } from "./ObservationFields";
import {
  ObservationPhotosField,
  useObservationPhotos,
} from "./ObservationPhotos";

const FORM_ID = "observation";
const NO_UNITS: ReadonlySet<string> = new Set();
/**
 * Records an observation day in one step: the date, the model its
 * photographs read for, and the photographs, each matched to its unit.
 */
export function RecordObservationDialog(props: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
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
  const previous = observations.at(-1);
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
              createObservation({
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
