import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { isAdmin } from "../../domain/auth/schema";
import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { WorkersTable } from "../../features/workers/WorkersTable";
import { getWorkers } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";

const workbench = getRouteApi("/_workbench");

export const Route = createFileRoute("/_workbench/workers")({
  loader: () => getWorkers(),
  staticData: { crumbs: () => [{ label: m.workers_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.workers_title()) }],
  }),
  pendingComponent: () => (
    <SettingsPageSkeleton>
      <TableSkeleton rows={3} />
    </SettingsPageSkeleton>
  ),
  component: WorkersPage,
});

function WorkersPage() {
  const { workers } = Route.useLoaderData();
  const { user } = workbench.useLoaderData();
  const [enrolling, setEnrolling] = useState(false);
  const administers = isAdmin(user);
  const enroll = () => setEnrolling(true);
  useRouteRefresh(5000);

  return (
    <SettingsPage
      title={m.workers_title()}
      actions={
        administers && workers.length > 0 ? (
          <Button type="primary" icon={Plus} onClick={enroll}>
            {m.worker_enroll()}
          </Button>
        ) : null
      }
    >
      <WorkersTable
        workers={workers}
        administers={administers}
        enroll={enroll}
      />
      {administers ? (
        <EnrollWorkerDialog
          open={enrolling}
          onClose={() => setEnrolling(false)}
        />
      ) : null}
    </SettingsPage>
  );
}
