import { Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ModelArea } from "../../domain/models/area";
import {
  MODEL_RECORD_KINDS,
  type ModelRecords,
} from "../../domain/models/contracts";
import type { Model } from "../../domain/models/schema";
import { removeModel, updateModelSettings } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { Form } from "../../ui/kit/Form";
import { TextArea } from "../../ui/kit/Input";
import { toast } from "../../ui/kit/Toast";
import { modelName } from "../../ui/model-names";
import { ModelAreaField } from "./ModelAreaField";

const FORM_ID = "model-settings";

/** A model page's secondary actions: its settings, and deleting a model nothing has been recorded against. */
export function ModelMenu({
  model,
  records,
}: {
  model: Model;
  records: ModelRecords;
}) {
  const confirmDestructive = useConfirmDestructive();
  const navigateAfterWrite = useNavigateAfterWrite();
  const [editing, setEditing] = useState(false);
  const name = modelName(model);

  const items: DropdownItem[] = [
    {
      key: "settings",
      icon: Settings2,
      label: m.model_menu_settings(),
      onClick: () => setEditing(true),
    },
  ];
  if (MODEL_RECORD_KINDS.every((kind) => records[kind] === 0)) {
    items.push(
      { type: "divider" },
      {
        key: "delete",
        danger: true,
        icon: Trash2,
        label: m.model_menu_delete(),
        onClick: () =>
          confirmDestructive({
            title: m.item_delete_title({ name }),
            confirmLabel: m.delete_action(),
            failure: m.model_not_deleted(),
            onConfirm: async () => {
              await removeModel({ data: { model: model.id } });
            },
            onSuccess: async () => {
              toast.success(m.item_deleted({ name }));
              await navigateAfterWrite({ to: "/models" });
            },
            invalidate: false,
          }),
      },
    );
  }

  return (
    <>
      <PageMenu label={m.item_actions({ name })} items={items} />
      <ModelSettingsDialog
        model={model}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

function ModelSettingsDialog({
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
      title={m.model_settings_title({ name: modelName(model) })}
      okText={m.save_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ModelSettingsForm model={model} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ModelSettingsForm({
  model,
  action: { busy, run },
  onDone,
}: {
  model: Model;
  action: AsyncAction;
  onDone: () => void;
}) {
  const [instructions, setInstructions] = useState(
    model.annotation.instructions,
  );
  const [area, setArea] = useState<ModelArea>(model.area);

  const submit = () => {
    void run(
      () =>
        updateModelSettings({
          data: {
            model: model.id,
            area,
            annotation: { ...model.annotation, instructions },
          },
        }),
      m.model_settings_not_saved(),
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
      <ModelAreaField value={area} onChange={setArea} disabled={busy} />
    </Form>
  );
}
