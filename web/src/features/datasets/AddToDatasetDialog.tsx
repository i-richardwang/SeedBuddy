import { useState } from "react";

import {
  DATASET_NAME_PATTERN,
  type NamedDataset,
} from "../../domain/datasets/schema";
import type { ObservationImageRef } from "../../domain/experiments/schema";
import {
  createDatasetFromImages,
  createDatasetMemberships,
} from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { Select } from "../../ui/kit/Select";
import { toast } from "../../ui/kit/Toast";

const NEW_DATASET = "\0new";
const FORM_ID = "add-to-dataset";

export function AddToDatasetDialog({
  open,
  images,
  datasets,
  heading = m.dataset_add_heading(),
  onClose,
}: {
  open: boolean;
  images: ObservationImageRef[];
  datasets: NamedDataset[];
  heading?: string;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={heading}
      okText={m.dataset_add_submit()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <AddToDatasetForm
        images={images}
        datasets={datasets}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function AddToDatasetForm({
  images,
  datasets,
  action: { busy, run },
  onDone,
}: {
  images: ObservationImageRef[];
  datasets: NamedDataset[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const [choice, setChoice] = useState(datasets[0]?.id ?? NEW_DATASET);
  const [name, setName] = useState("");

  const submit = () => {
    void run(
      () =>
        choice === NEW_DATASET
          ? createDatasetFromImages({ data: { name, images } })
          : createDatasetMemberships({ data: { dataset: choice, images } }),
      m.dataset_add_nothing_added(),
      {
        onSuccess: (value) => {
          const { added, existing } = value;
          const dataset = value.dataset.name;
          onDone();
          toast.success(
            existing > 0
              ? m.dataset_add_result_existing({ added, dataset, existing })
              : m.dataset_add_result({ added, dataset }),
          );
        },
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
      <Form.Field label={m.dataset_add_dataset_label()}>
        <Select
          value={choice}
          disabled={busy}
          onChange={setChoice}
          options={[
            ...datasets.map((dataset) => ({
              value: dataset.id,
              label: dataset.name,
            })),
            { value: NEW_DATASET, label: m.dataset_add_new() },
          ]}
        />
      </Form.Field>
      {choice === NEW_DATASET ? (
        <Form.Field label={m.dataset_name_label()} required>
          <Input
            value={name}
            onValueChange={setName}
            pattern={DATASET_NAME_PATTERN}
            placeholder={m.dataset_add_name_placeholder()}
            disabled={busy}
            autoFocus
          />
        </Form.Field>
      ) : null}
    </Form>
  );
}
