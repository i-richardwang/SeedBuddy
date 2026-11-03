import { useState } from "react";

import type { DatasetTrainingReadiness } from "../../domain/datasets/read-model";
import {
  effectiveOverrides,
  type TrainingOverrides,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import type {
  TrainingPreset,
  TrainingPresetId,
} from "../../domain/training/recipes";
import { createTrainingRun } from "../../functions/training";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { toast } from "../../ui/kit/Toast";
import { trainingPresetDescription, trainingPresetLabel } from "./labels";
import { TrainingParametersForm } from "./TrainingParametersForm";
import { TrainingWorkerSelect } from "./TrainingWorkerSelect";

const FORM_ID = "train";

/** What starting a run from a training set needs to know. */
interface TrainingSet {
  dataset: string;
  trainingPresets: readonly TrainingPreset[];
  defaultTrainingPresetId: TrainingPresetId;
  training: DatasetTrainingReadiness;
}

/** A new run's preset, its Worker and its parameters, chosen before it is queued. */
export function TrainDialog({
  set,
  open,
  onClose,
}: {
  set: TrainingSet;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogSession open={open}>
      {(afterClose) => (
        <TrainSession
          set={set}
          open={open}
          onClose={onClose}
          afterClose={afterClose}
        />
      )}
    </DialogSession>
  );
}

function TrainSession({
  set: { dataset, trainingPresets, defaultTrainingPresetId, training },
  open,
  onClose,
  afterClose,
}: {
  set: TrainingSet;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const action = useAsyncAction();
  const [presetId, setPresetId] = useState(defaultTrainingPresetId);
  const [overrides, setOverrides] = useState<TrainingOverrides>({});
  const presetOf = (id: TrainingPresetId) =>
    trainingPresets.find((candidate) => candidate.id === id)!;
  const preset = presetOf(presetId);
  const [targetWorkerId, setTargetWorkerId] = useState<string | null>(null);
  const valid = trainingOverridesSchema.safeParse(overrides).success;

  const submit = () => {
    void action.run(
      () =>
        createTrainingRun({
          data: { dataset, presetId, overrides, targetWorkerId },
        }),
      m.training_not_started(),
      {
        onSuccess: () => {
          onClose();
          toast.success(m.training_queued());
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.training_dialog_title()}
      okText={m.training_button()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={!valid}
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {training.workerMemoryBytes === null ? (
          <Alert type="warning" title={m.training_worker_unavailable()} />
        ) : null}
        <Form.Field
          label={m.training_preset()}
          desc={trainingPresetDescription(presetId)}
        >
          <Select
            value={presetId}
            disabled={action.busy}
            options={trainingPresets.map((option) => ({
              value: option.id,
              label: trainingPresetLabel(option.id),
            }))}
            onChange={(id) => {
              setPresetId(id);
              setOverrides(
                effectiveOverrides(overrides, presetOf(id).recipe.parameters),
              );
            }}
          />
        </Form.Field>
        <Form.Field label={m.worker_label()}>
          <TrainingWorkerSelect
            workers={training.workers}
            value={targetWorkerId}
            onChange={setTargetWorkerId}
            disabled={action.busy}
          />
        </Form.Field>
        <TrainingParametersForm
          parameters={preset.recipe.parameters}
          overrides={overrides}
          onChange={setOverrides}
          disabled={action.busy}
        />
      </Form>
    </FormDialog>
  );
}
