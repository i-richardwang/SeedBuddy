import type { ExperimentObservationImageDetail } from "../../domain/experiments/read-model";
import { updateObservationImages } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { ImageDropZone } from "../upload/ImageDropZone";
import { useUploads } from "../upload/useUploads";

const FORM_ID = "replace-image";

interface ReplaceObservationImageDialogProps {
  image: ExperimentObservationImageDetail;
  open: boolean;
  onClose: () => void;
}

/** Puts another photograph in place of the one a unit holds at this observation. */
export function ReplaceObservationImageDialog(
  props: ReplaceObservationImageDialogProps,
) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => (
        <ReplaceObservationImageSession {...props} afterClose={afterClose} />
      )}
    </DialogSession>
  );
}

function ReplaceObservationImageSession({
  image,
  open,
  onClose,
  afterClose,
}: ReplaceObservationImageDialogProps & { afterClose: () => void }) {
  const uploads = useUploads();
  const action = useAsyncAction();
  const [replacement] = uploads.images.flatMap((item) =>
    item.state.status === "stored"
      ? [
          {
            unit: image.unit.id,
            digest: item.state.digest,
            filename: item.file.name,
          },
        ]
      : [],
  );

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.unit_replace_heading({ file: image.review.filename })}
      okText={
        uploads.storing ? m.observation_images_uploading() : m.unit_replace()
      }
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={uploads.storing || replacement === undefined}
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          if (!replacement) return;
          void action.run(
            () =>
              updateObservationImages({
                data: {
                  experiment: image.ref.experiment,
                  observation: image.observation.id,
                  images: [replacement],
                },
              }),
            m.unit_image_not_replaced(),
            {
              onSuccess: onClose,
            },
          );
        }}
      >
        <ImageDropZone
          images={uploads.images}
          onAdd={uploads.add}
          onRemove={uploads.remove}
          disabled={action.busy}
          multiple={false}
        />
      </Form>
    </FormDialog>
  );
}
