import { Link, useRouter } from "@tanstack/react-router";
import { Plus, Server, Trash2 } from "lucide-react";
import type { WorkerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";
import { deleteWorker, type getWorkers } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { RowMenu } from "../../ui/ActionsMenu";
import { formatAge } from "../../ui/Timestamp";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Status, type StatusTone } from "../../ui/kit/Status";
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

const PRESENCE: Record<
  WorkerPresence,
  { label: () => string; tone: StatusTone }
> = {
  online: { label: m.worker_presence_online, tone: "success" },
  stale: { label: m.worker_presence_stale, tone: "warning" },
  offline: { label: m.worker_presence_offline, tone: "neutral" },
};

type WorkerStatus = Awaited<ReturnType<typeof getWorkers>>["workers"][number];

export function WorkersTable({
  workers,
  administers,
  enroll,
}: {
  workers: WorkerStatus[];
  administers: boolean;
  enroll: () => void;
}) {
  return (
    <Table
      narrow="cards"
      aria-label={m.workers_workers()}
      empty={
        workers.length === 0 && (
          <Empty
            icon={Server}
            title={m.workers_empty()}
            description={
              administers
                ? m.workers_empty_description_admin()
                : m.workers_empty_description_member()
            }
            action={
              administers ? (
                <Button type="primary" icon={Plus} onClick={enroll}>
                  {m.worker_enroll()}
                </Button>
              ) : null
            }
          />
        )
      }
    >
      <TableHeader>
        <tr>
          <TableHead>{m.workers_column_worker()}</TableHead>
          <TableHead className="w-28">{m.workers_column_presence()}</TableHead>
          <TableHead>{m.workers_column_activity()}</TableHead>
          <TableHead className="w-36">{m.workers_column_seen()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.workers_column_actions()}</span>
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
  worker: WorkerStatus;
  administers: boolean;
}) {
  const presence = PRESENCE[worker.presence];

  return (
    <TableRow>
      <TableCell cellSlot="title">{worker.workerId}</TableCell>
      <TableCell cellLabel={m.workers_column_presence()}>
        <Status tone={presence.tone}>{presence.label()}</Status>
      </TableCell>
      <TableCell cellLabel={m.workers_column_activity()}>
        <Activity activity={worker.activity} />
      </TableCell>
      <TableCell
        cellLabel={m.workers_column_seen()}
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
  const router = useRouter();

  return (
    <RowMenu
      label={m.worker_actions({ name: workerId })}
      items={[
        {
          key: "remove",
          icon: Trash2,
          label: m.worker_remove_item(),
          danger: true,
          onClick: () =>
            confirmDestructive({
              title: m.worker_remove_title({ name: workerId }),
              content: m.worker_remove_description(),
              confirmLabel: m.worker_remove(),
              onConfirm: async () => {
                await deleteWorker({ data: { workerId } });
              },
              onSuccess: () => {
                toast.success(m.worker_removed({ name: workerId }));
              },
              invalidate: () => router.invalidate(),
            }),
        },
      ]}
    />
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) return m.worker_activity_idle();
  if (activity.kind === "inference") {
    return m.worker_activity_inference({ image: activity.image });
  }
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/runs/$runId"
          params={{ dataset: activity.dataset.id, runId: activity.runId }}
        />
      }
    >
      {m.worker_activity_training({ dataset: activity.dataset.name })}
    </TextLink>
  );
}
