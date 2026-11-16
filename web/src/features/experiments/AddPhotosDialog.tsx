import type { ExperimentObservation } from "../../domain/experiments/schema";
import { updateObservationImages } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { observationLabel } from "./labels";
import {
  ObservationPhotosField,
  type PhotoPlacing,
  useObservationPhotos,
} from "./observation-photos";

const FORM_ID = "add-photos";

interface AddPhotosDialogProps {
  experiment: string;
  observation: ExperimentObservation;
  /** The day's units with those it already holds a photograph of, and the reader's batches. */
  placing: PhotoPlacing;
  open: boolean;
  onClose: () => void;
}

/** Adds photographs to an observation day already recorded, each matched to its unit. */
export function AddPhotosDialog(props: AddPhotosDialogProps) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => <AddPhotosSession {...props} afterClose={afterClose} />}
    </DialogSession>
  );
}

function AddPhotosSession({
  experiment,
  observation,
  placing,
  open,
  onClose,
  afterClose,
}: AddPhotosDialogProps & { afterClose: () => void }) {
  const action = useAsyncAction();
  const photos = useObservationPhotos({
    experiment,
    placing,
    day: observation.observedOn,
  });
  const canSubmit = !action.busy && !photos.pending && photos.ready.length > 0;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.observation_photos_heading({
        observation: observationLabel(observation),
      })}
      okText={
        photos.onHand.storing
          ? m.observation_photos_uploading()
          : m.observation_photos_match_count({ count: photos.ready.length })
      }
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={!canSubmit}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          void action.run(
            () =>
              updateObservationImages({
                data: {
                  experiment,
                  observation: observation.id,
                  images: photos.ready,
                },
              }),
            m.observation_photos_not_matched(),
            {
              onSuccess: onClose,
            },
          );
        }}
      >
        <ObservationPhotosField photos={photos} disabled={action.busy} />
      </Form>
    </FormDialog>
  );
}
