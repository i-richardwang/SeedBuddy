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
import { toast } from "../../ui/kit/Toast";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { controlRun } from "./run-control";
import {
  TrainingWorkerSelect,
  trainingWorkerHint,
} from "./TrainingWorkerSelect";

const FORM_ID = "resume-training";

/**
 * Continues a paused run or retries a failed one, on the Worker it names;
 * a run with saved progress picks it up on the Worker holding it unless told
 * to start over, and can only start over when the person cannot send
 * training to that Worker.
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
      okText={retry ? m.retry_action() : m.training_resume()}
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
  const saved = run.checkpoint;
  const offered = (workerId: string | null) =>
    workers.some((worker) => worker.workerId === workerId);
  const resumable = saved !== null && offered(saved.workerId);
  const [targetWorkerId, setTargetWorkerId] = useState(
    offered(run.targetWorkerId) ? run.targetWorkerId : null,
  );
  const [from, setFrom] = useState<"saved" | "start">(
    resumable ? "saved" : "start",
  );

  const workerId = from === "saved" && saved ? saved.workerId : targetWorkerId;
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            controlRun(detail, {
              action: "resume",
              targetWorkerId: workerId,
              restart: from === "start",
            }),
          run.state.status === "failed"
            ? m.training_not_retried()
            : m.training_not_continued(),
          {
            onSuccess: () => {
              toast.success(m.training_queued());
              onDone();
            },
          },
        );
      }}
    >
      <Form.Field
        label={m.worker_label()}
        desc={trainingWorkerHint(workers, workerId)}
      >
        <TrainingWorkerSelect
          workers={workers}
          value={workerId}
          onChange={setTargetWorkerId}
          disabled={action.busy || from === "saved"}
        />
      </Form.Field>
      {from === "saved" && saved && (
        <Text size="sm" type="secondary">
          {m.training_worker_resume_local({ worker: saved.workerId })}
        </Text>
      )}
      {saved && !resumable && (
        <Text size="sm" type="secondary">
          {m.training_worker_resume_unavailable({ worker: saved.workerId })}
        </Text>
      )}
      {saved ? (
        <Form.Field label={m.training_resume_from()} fieldset>
          <ToggleGroup
            aria-label={m.training_resume_from()}
            value={from}
            onChange={setFrom}
            options={[
              {
                value: "saved",
                label: m.training_resume_from_saved({ epoch: saved.epoch }),
                disabled: action.busy || !resumable,
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
