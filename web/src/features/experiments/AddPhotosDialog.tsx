import { useRouter } from "@tanstack/react-router";

import type { Unit } from "../../domain/experiments/contracts";
import type { PlacedPhoto } from "../../domain/experiments/photos";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { assignImagesToObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { observationLabel } from "./labels";
import {
  ObservationPhotosField,
  useObservationPhotos,
} from "./ObservationPhotos";

const FORM_ID = "add-photos";

interface AddPhotosDialogProps {
  experiment: string;
  observation: ExperimentObservation;
  /** The units that can still be photographed at this observation. */
  units: readonly Unit[];
  /** Units that already have a photograph that day. */
  assigned: ReadonlySet<string>;
  /** The photographs the experiment already holds. */
  placed: readonly PlacedPhoto[];
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
  units,
  assigned,
  placed,
  open,
  onClose,
  afterClose,
}: AddPhotosDialogProps & { afterClose: () => void }) {
  const router = useRouter();
  const action = useAsyncAction();
  const photos = useObservationPhotos({ units, assigned, placed });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.observation_images_heading({
        observation: observationLabel(observation),
      })}
      okText={
        photos.uploads.storing
          ? m.observation_images_uploading()
          : m.observation_images_assign_count({ count: photos.ready.length })
      }
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={photos.pending || photos.ready.length === 0}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            () =>
              assignImagesToObservation({
                data: {
                  experiment,
                  observation: observation.id,
                  images: photos.ready,
                },
              }),
            m.observation_images_assign_failed(),
            {
              onSuccess: onClose,
              invalidate: () => router.invalidate(),
            },
          );
        }}
      >
        <ObservationPhotosField photos={photos} disabled={action.busy} />
      </Form>
    </FormDialog>
  );
}
