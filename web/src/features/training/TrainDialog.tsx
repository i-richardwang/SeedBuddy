import { TrainingWorkerSelect } from "./TrainingWorkerSelect";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../functions/training";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import type { DatasetTrainingReadiness } from "../../domain/training/read-model";
import type {
  TrainingPreset,
  TrainingPresetId,
} from "../../domain/training/recipes";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { toast } from "../../ui/kit/Toast";
import { Select } from "../../ui/kit/Select";
import { TrainingParametersForm } from "./TrainingParametersForm";
import {
  effectiveOverrides,
  type TrainingOverrides,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../domain/training/schema";

const FORM_ID = "train";

/** What starting a run from a training set needs to know. */
interface TrainingSet {
  dataset: string;
  /** How many of its images are reviewed, and so train. */
  reviewed: number;
  trainingPresets: readonly TrainingPreset[];
  defaultTrainingPresetId: TrainingPresetId;
  training: DatasetTrainingReadiness;
}

/** Why a new run cannot start now, or null when it can. */
export function trainRefusal({
  reviewed,
  training,
}: Pick<TrainingSet, "reviewed" | "training">) {
  if (training.active !== null) return m.training_refused_active();
  if (reviewed < MIN_SNAPSHOT_IMAGES) {
    return m.training_refused_reviewed({ count: MIN_SNAPSHOT_IMAGES });
  }
  return null;
}

/** A new run's preset, its worker and its parameters, chosen before it is queued. */
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
  const router = useRouter();
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
        startTrainingRun({
          data: { dataset, presetId, overrides, targetWorkerId },
        }),
      m.training_not_started(),
      {
        onSuccess: () => {
          onClose();
          toast.success(m.training_queued());
        },
        invalidate: () => router.invalidate(),
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
          <Alert type="warning" title={m.training_dialog_no_worker()} />
        ) : null}
        <Form.Field
          label={m.training_preset()}
          desc={PRESET_PRESENTATION[presetId].description()}
        >
          <Select
            value={presetId}
            disabled={action.busy}
            options={trainingPresets.map((option) => ({
              value: option.id,
              label: PRESET_PRESENTATION[option.id].label(),
            }))}
            onChange={(id) => {
              setPresetId(id);
              setOverrides(
                effectiveOverrides(overrides, presetOf(id).recipe.parameters),
              );
            }}
          />
        </Form.Field>
        <Form.Field label={m.training_worker()}>
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

const PRESET_PRESENTATION: Record<
  TrainingPresetId,
  {
    label: () => string;
    description: () => string;
  }
> = {
  "yolo26n-whole-v1": {
    label: m.training_preset_nano,
    description: m.training_preset_nano_description,
  },
  "yolo26s-whole-2048-v1": {
    label: m.training_preset_small,
    description: m.training_preset_small_description,
  },
};
