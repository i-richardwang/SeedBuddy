import { useState } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Text } from "../../ui/kit/Text";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { controlRun } from "./run-control";
import { TrainingWorkerSelect } from "./TrainingWorkerSelect";

const FORM_ID = "resume-training";

/**
 * Continues a paused run or retries a failed one, on the worker it names;
 * a run with saved progress picks it up there unless told to start over.
 */
export function ResumeTrainingDialog({
  detail,
  open,
  onClose,
}: {
  detail: TrainingRunDetail;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  const retry = detail.run.state.status === "failed";
  const run = identifierLabel(detail.run.id);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        retry
          ? m.training_retry_title({ run })
          : m.training_resume_title({ run })
      }
      okText={retry ? m.training_retry() : m.training_resume()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ResumeTrainingForm detail={detail} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ResumeTrainingForm({
  detail,
  action,
  onDone,
}: {
  detail: TrainingRunDetail;
  action: AsyncAction;
  onDone: () => void;
}) {
  const { run, workers } = detail;
  const [targetWorkerId, setTargetWorkerId] = useState(run.targetWorkerId);
  const [from, setFrom] = useState<"saved" | "start">(
    run.checkpoint ? "saved" : "start",
  );

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            controlRun(detail, {
              action: "resume",
              targetWorkerId:
                from === "saved"
                  ? (run.checkpoint?.workerId ?? run.targetWorkerId)
                  : targetWorkerId,
              restart: from === "start",
            }),
          m.training_resume_failed(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <Form.Field label={m.training_worker()}>
        <TrainingWorkerSelect
          workers={workers}
          value={
            from === "saved"
              ? (run.checkpoint?.workerId ?? run.targetWorkerId)
              : targetWorkerId
          }
          onChange={setTargetWorkerId}
          disabled={action.busy || from === "saved"}
        />
      </Form.Field>
      {from === "saved" && run.checkpoint && (
        <Text size="sm" type="secondary">
          {m.training_resume_local_worker({ worker: run.checkpoint.workerId })}
        </Text>
      )}
      {run.checkpoint ? (
        <Form.Field label={m.training_resume_from()} fieldset>
          <ToggleGroup
            aria-label={m.training_resume_from()}
            value={from}
            onChange={setFrom}
            options={[
              {
                value: "saved",
                label: m.training_resume_from_saved({
                  epoch: run.checkpoint.epoch,
                }),
                disabled: action.busy,
              },
              {
                value: "start",
                label: m.training_resume_from_start(),
                disabled: action.busy,
              },
            ]}
          />
        </Form.Field>
      ) : (
        <Text size="sm" type="secondary">
          {m.training_resume_no_progress()}
        </Text>
      )}
    </Form>
  );
}
