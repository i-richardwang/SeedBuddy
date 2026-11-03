import type { TrainingWorkerOverview } from "../../domain/workers/read-model";
import { m } from "../../paraglide/messages";
import { Select } from "../../ui/kit/Select";

/** The Worker a run goes to, or any that is free, named by the field that holds it. */
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
          label: worker.online
            ? worker.workerId
            : m.training_worker_offline({ worker: worker.workerId }),
        })),
      ]}
    />
  );
}
