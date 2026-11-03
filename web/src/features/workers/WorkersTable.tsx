import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { WorkerOverview } from "../../domain/workers/read-model";
import type { WorkerActivity } from "../../domain/workers/schema";
import { removeWorker } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { RowMenu } from "../../ui/ActionsMenu";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";
import { workerPresenceLabel, workerPresenceTone } from "./labels";

export function WorkersTable({
  workers,
  administers,
  empty,
}: {
  workers: WorkerOverview[];
  administers: boolean;
  empty: ReactNode;
}) {
  return (
    <Table
      narrow="cards"
      aria-label={m.workers_title()}
      empty={workers.length === 0 ? empty : undefined}
    >
      <TableHeader>
        <tr>
          <TableHead>{m.worker_column_worker()}</TableHead>
          <TableHead className="w-28">{m.worker_column_presence()}</TableHead>
          <TableHead>{m.worker_column_activity()}</TableHead>
          <TableHead className="w-36">{m.worker_column_seen()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {workers.map((worker) => (
          <WorkerRow
            key={worker.workerId}
            worker={worker}
            administers={administers}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function WorkerRow({
  worker,
  administers,
}: {
  worker: WorkerOverview;
  administers: boolean;
}) {
  return (
    <TableRow>
      <TableCell cellSlot="title">{worker.workerId}</TableCell>
      <TableCell cellLabel={m.worker_column_presence()}>
        <Status tone={workerPresenceTone(worker.presence)}>
          {workerPresenceLabel(worker.presence)}
        </Status>
      </TableCell>
      <TableCell cellLabel={m.worker_column_activity()}>
        <Activity activity={worker.activity} />
      </TableCell>
      <TableCell
        cellLabel={m.worker_column_seen()}
        className="whitespace-nowrap"
      >
        {worker.lastSeenSeconds === null
          ? m.worker_never_seen()
          : formatAge(worker.lastSeenSeconds)}
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        {administers ? <WorkerMenu workerId={worker.workerId} /> : null}
      </TableCell>
    </TableRow>
  );
}

function WorkerMenu({ workerId }: { workerId: string }) {
  const confirmDestructive = useConfirmDestructive();

  return (
    <RowMenu
      label={m.worker_actions({ name: workerId })}
      items={[
        {
          key: "remove",
          icon: Trash2,
          label: m.worker_menu_remove(),
          danger: true,
          onClick: () =>
            confirmDestructive({
              title: m.worker_remove_title({ name: workerId }),
              content: m.worker_remove_description(),
              confirmLabel: m.worker_remove(),
              onConfirm: async () => {
                await removeWorker({ data: { workerId } });
              },
              onSuccess: () => {
                toast.success(m.worker_removed({ name: workerId }));
              },
            }),
        },
      ]}
    />
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) return m.worker_activity_idle();
  if (activity.kind === "inference") {
    return m.worker_activity_inference({
      image: activity.subject.filename ?? "an image",
    });
  }
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/runs/$runId"
          params={{
            dataset: activity.subject.dataset.id,
            runId: activity.subject.runId,
          }}
        />
      }
    >
      {m.worker_activity_training({ dataset: activity.subject.dataset.name })}
    </TextLink>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return m.worker_age_seconds({ count: seconds });
  if (seconds < 3600) {
    return m.worker_age_minutes({ count: Math.floor(seconds / 60) });
  }
  if (seconds < 86400) {
    return m.worker_age_hours({ count: Math.floor(seconds / 3600) });
  }
  return m.worker_age_days({ count: Math.floor(seconds / 86400) });
}
