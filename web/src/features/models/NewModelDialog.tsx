import { useState } from "react";

import type { ModelAnnotation } from "../../domain/models/schema";
import { createModel } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input, TextArea } from "../../ui/kit/Input";
import { AnnotationAreaField } from "./AnnotationAreaField";

const FORM_ID = "model";

function classList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function NewModelDialog({
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
      title={m.model_new()}
      okText={m.create_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ModelForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ModelForm({
  action: { busy, run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [classes, setClasses] = useState("");
  const [instructions, setInstructions] = useState("");
  const [area, setArea] = useState<ModelAnnotation["area"]>("image");

  const submit = () => {
    void run(
      () =>
        createModel({
          data: {
            id,
            name,
            classes: classList(classes),
            annotation: { instructions, area },
          },
        }),
      m.model_not_created(),
      {
        onSuccess: onDone,
      },
    );
  };

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Form.Field label={m.name_label({ kind: "thing" })} required>
        <Input value={name} onValueChange={setName} disabled={busy} autoFocus />
      </Form.Field>
      <Form.Field label={m.model_id_label()} required>
        <Input
          value={id}
          onValueChange={setId}
          placeholder={m.model_id_placeholder()}
          disabled={busy}
        />
      </Form.Field>
      <Form.Field label={m.model_classes_label()} required>
        <TextArea
          rows={3}
          value={classes}
          onChange={(event) => setClasses(event.currentTarget.value)}
          placeholder={m.model_classes_placeholder()}
          disabled={busy}
        />
      </Form.Field>
      <Form.Field label={m.model_annotation_label()}>
        <TextArea
          rows={4}
          value={instructions}
          onChange={(event) => setInstructions(event.currentTarget.value)}
          placeholder={m.model_annotation_placeholder()}
          disabled={busy}
        />
      </Form.Field>
      <AnnotationAreaField value={area} onChange={setArea} disabled={busy} />
    </Form>
  );
}
