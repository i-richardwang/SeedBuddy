import type { TrainingWorkerOverview } from "../../domain/workers/read-model";
import { m } from "../../paraglide/messages";
import { Select } from "../../ui/kit/Select";

/** What sending a run to the Worker asks of the person, when it is their own computer. */
export function trainingWorkerHint(
  workers: TrainingWorkerOverview[],
  workerId: string | null,
): string | undefined {
  return workers.find((worker) => worker.workerId === workerId)?.personal
    ? m.training_worker_personal_hint()
    : undefined;
}

function workerLabel({
  workerId: worker,
  online,
  personal,
}: TrainingWorkerOverview): string {
  if (personal)
    return online
      ? m.training_worker_personal({ worker })
      : m.training_worker_personal_offline({ worker });
  return online ? worker : m.training_worker_offline({ worker });
}

/**
 * The Worker a run goes to, or any shared one that is free, named by the
 * field that holds it. The person's own computers are marked as theirs.
 */
export function TrainingWorkerSelect({
  workers,
  value,
  onChange,
  disabled,
}: {
  workers: TrainingWorkerOverview[];
  value: string | null;
  onChange: (workerId: string | null) => void;
  disabled: boolean;
}) {
  return (
    <Select
      value={value ?? ""}
      disabled={disabled}
      onChange={(id) => onChange(id || null)}
      options={[
        { value: "", label: m.training_worker_auto() },
        ...workers.map((worker) => ({
          value: worker.workerId,
          label: workerLabel(worker),
        })),
      ]}
    />
  );
}
