import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Plus, Server } from "lucide-react";
import { useState } from "react";

import { isAdmin } from "../../domain/auth/schema";
import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { WorkersTable } from "../../features/workers/WorkersTable";
import { getWorkers } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";

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
        empty={
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
        }
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
