import { useRouter } from "@tanstack/react-router";
import { NotebookPen, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Model, ModelAnnotation } from "../../domain/models/schema";
import { removeModel, updateModelAnnotation } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { Form } from "../../ui/kit/Form";
import { TextArea } from "../../ui/kit/Input";
import { toast } from "../../ui/kit/Toast";
import { modelName } from "../../ui/model-names";
import { PageMenu } from "../../ui/ActionsMenu";
import { AnnotationAreaField } from "./AnnotationAreaField";

const FORM_ID = "model-annotation";

/** A model page's secondary actions: its annotation guide, and deleting a model nothing has been recorded against. */
export function ModelMenu({
  model,
  deletable,
}: {
  model: Model;
  deletable: boolean;
}) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const [editing, setEditing] = useState(false);
  const name = modelName(model);

  const items: DropdownItem[] = [
    {
      key: "annotation",
      icon: NotebookPen,
      label: m.model_menu_annotation(),
      onClick: () => setEditing(true),
    },
  ];
  if (deletable) {
    items.push(
      { type: "divider" },
      {
        key: "delete",
        danger: true,
        icon: Trash2,
        label: m.model_menu_delete_item(),
        onClick: () =>
          confirmDestructive({
            title: m.model_delete_title({ name }),
            confirmLabel: m.model_delete(),
            onConfirm: async () => {
              await removeModel({ data: { model: model.id } });
              toast.success(m.model_deleted({ name }));
              await navigateAfterWrite({ to: "/models" });
            },
          }),
      },
    );
  }

  return (
    <>
      <PageMenu label={m.model_actions({ name })} items={items} />
      <ModelAnnotationDialog
        model={model}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

function ModelAnnotationDialog({
  model,
  open,
  onClose,
}: {
  model: Model;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.model_annotation_title({ name: modelName(model) })}
      okText={m.model_annotation_save()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ModelAnnotationForm model={model} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ModelAnnotationForm({
  model,
  action: { busy, run },
  onDone,
}: {
  model: Model;
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [instructions, setInstructions] = useState(
    model.annotation.instructions,
  );
  const [area, setArea] = useState<ModelAnnotation["area"]>(
    model.annotation.area,
  );

  const submit = () => {
    void run(
      () =>
        updateModelAnnotation({
          data: {
            model: model.id,
            annotation: { ...model.annotation, instructions, area },
          },
        }),
      m.model_annotation_not_saved(),
      {
        onSuccess: onDone,
        invalidate: () => router.invalidate(),
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
      <Form.Field label={m.model_annotation_label()}>
        <TextArea
          rows={8}
          value={instructions}
          onChange={(event) => setInstructions(event.currentTarget.value)}
          placeholder={m.model_annotation_placeholder()}
          disabled={busy}
          autoFocus
        />
      </Form.Field>
      <AnnotationAreaField value={area} onChange={setArea} disabled={busy} />
    </Form>
  );
}
