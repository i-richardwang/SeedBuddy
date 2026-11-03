import { Download, PencilLine } from "lucide-react";
import { useState } from "react";

import {
  DATASET_NAME_PATTERN,
  type NamedDataset,
} from "../../domain/datasets/schema";
import { updateDataset } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";

const FORM_ID = "rename-dataset";

/**
 * A dataset page's secondary actions: renaming it, and downloading its
 * archive, which is served as an attachment so the page stays open.
 */
export function DatasetMenu({ dataset }: { dataset: NamedDataset }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <PageMenu
        label={m.item_actions({ name: dataset.name })}
        items={[
          {
            key: "rename",
            icon: PencilLine,
            label: m.dataset_rename(),
            onClick: () => setRenaming(true),
          },
          {
            key: "download",
            icon: Download,
            label: m.dataset_download(),
            href: `/datasets/${dataset.id}/archive`,
          },
        ]}
      />
      <RenameDatasetDialog
        dataset={dataset}
        open={renaming}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}

function RenameDatasetDialog({
  dataset,
  open,
  onClose,
}: {
  dataset: NamedDataset;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.dataset_rename_title({ dataset: dataset.name })}
      okText={m.dataset_rename_save()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <RenameDatasetForm dataset={dataset} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function RenameDatasetForm({
  dataset,
  action: { busy, run },
  onDone,
}: {
  dataset: NamedDataset;
  action: AsyncAction;
  onDone: () => void;
}) {
  const [name, setName] = useState(dataset.name);

  const submit = () => {
    void run(
      () => updateDataset({ data: { dataset: dataset.id, name } }),
      m.dataset_not_renamed(),
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
        <Input
          value={name}
          onValueChange={setName}
          pattern={DATASET_NAME_PATTERN}
          disabled={busy}
          autoFocus
        />
      </Form.Field>
    </Form>
  );
}
