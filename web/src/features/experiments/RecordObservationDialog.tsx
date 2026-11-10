import { useState } from "react";

import type { PhotoSlots } from "../../domain/experiments/read-model";
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
} from "./observation-photos";

const FORM_ID = "observation";

/**
 * Records an observation day in one step: the date, the model its
 * photographs read for, and the photographs, each matched to its unit.
 */
export function RecordObservationDialog(props: {
  experiment: string;
  inoculatedOn: CalendarDay;
  models: readonly Model[];
  observations: readonly ExperimentObservation[];
  /** The experiment's units a photograph may be placed on. */
  slots: PhotoSlots;
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
  slots,
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
    countedClasses: previous?.countedClasses ?? models[0]!.countedClasses,
    note: "",
  }));
  const photos = useObservationPhotos({
    experiment,
    slots,
    day: value.observedOn,
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.observation_record()}
      okText={
        photos.uploads.storing
          ? m.observation_photos_uploading()
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
            m.observation_not_recorded(),
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
