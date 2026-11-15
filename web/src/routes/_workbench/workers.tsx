import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Download, Plus, Server } from "lucide-react";
import { useState } from "react";

import { isAdmin } from "../../domain/auth/schema";
import { readWorkerInstallCommand } from "../../features/workers/commands";
import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { InstallWorkerDialog } from "../../features/workers/InstallWorkerDialog";
import { WorkersTable } from "../../features/workers/WorkersTable";
import { getWorkers } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { documentTitle } from "../../ui/documentTitle";
import { useLoadedDialog } from "../../ui/hooks/useLoadedDialog";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";

const workbench = getRouteApi("/_workbench");

export const Route = createFileRoute("/_workbench/workers")({
  loader: () => getWorkers(),
  staticData: { crumbs: () => [{ label: m.workers_label() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.workers_label()) }],
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
  // The install command names the package this workbench ships, read when
  // it is asked for rather than with every refresh of the list.
  const installing = useLoadedDialog<{ install: string | null }>();
  const administers = isAdmin(user);
  const enroll = () => setEnrolling(true);
  const install = () =>
    installing.show(
      "install",
      readWorkerInstallCommand,
      m.worker_install_not_loaded(),
    );

  return (
    <SettingsPage
      title={m.workers_label()}
      actions={
        <>
          {workers.length > 0 ? (
            <Button type="primary" icon={Plus} onClick={enroll}>
              {m.worker_enroll()}
            </Button>
          ) : null}
          <PageMenu
            label={m.item_actions({ name: m.workers_label() })}
            items={[
              {
                key: "install",
                icon: Download,
                label: m.worker_menu_install(),
                onClick: install,
              },
            ]}
          />
        </>
      }
    >
      <WorkersTable
        workers={workers}
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
              <Button type="primary" icon={Plus} onClick={enroll}>
                {m.worker_enroll()}
              </Button>
            }
          />
        }
      />
      <EnrollWorkerDialog
        administers={administers}
        open={enrolling}
        onClose={() => setEnrolling(false)}
      />
      {installing.last ? (
        <InstallWorkerDialog
          command={installing.last.value}
          open={installing.open}
          onClose={installing.close}
        />
      ) : null}
    </SettingsPage>
  );
}
