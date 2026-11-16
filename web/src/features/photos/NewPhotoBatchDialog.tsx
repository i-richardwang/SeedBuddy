import { useState } from "react";

import { createPhotoBatch } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";

const FORM_ID = "photo-batch";

/** Names a new batch and opens it, ready for its photographs. */
export function NewPhotoBatchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.photo_batch_new()}
      okText={m.create_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <PhotoBatchForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

function PhotoBatchForm({
  action: { busy, run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const [name, setName] = useState("");

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => createPhotoBatch({ data: { name } }),
          m.photo_batch_not_created(),
          {
            invalidate: false,
            onSuccess: async (batch) => {
              onDone();
              await navigateAfterWrite({
                to: "/photos/$batch",
                params: { batch: batch.id },
              });
            },
          },
        );
      }}
    >
      <Form.Field label={m.name_label({ kind: "thing" })} required>
        <Input value={name} onValueChange={setName} disabled={busy} autoFocus />
      </Form.Field>
    </Form>
  );
}
