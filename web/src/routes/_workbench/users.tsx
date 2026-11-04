import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { isAdmin } from "../../domain/auth/schema";
import { NewUserDialog } from "../../features/users/NewUserDialog";
import { UsersTable } from "../../features/users/UsersTable";
import { getUsers } from "../../functions/users";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";

const workbench = getRouteApi("/_workbench");

export const Route = createFileRoute("/_workbench/users")({
  loader: async ({ parentMatchPromise }) => {
    const { loaderData } = await parentMatchPromise;
    if (!loaderData || !isAdmin(loaderData.user)) throw notFound();
    return getUsers();
  },
  staticData: { crumbs: () => [{ label: m.users_label() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.users_label()) }],
  }),
  pendingComponent: () => (
    <SettingsPageSkeleton>
      <TableSkeleton rows={3} />
    </SettingsPageSkeleton>
  ),
  component: UsersPage,
});

function UsersPage() {
  const accounts = Route.useLoaderData();
  const { user: me } = workbench.useLoaderData();
  const [creating, setCreating] = useState(false);

  return (
    <SettingsPage
      title={m.users_label()}
      actions={
        <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
          {m.users_new()}
        </Button>
      }
    >
      <UsersTable accounts={accounts} currentUserId={me.id} />
      <NewUserDialog open={creating} onClose={() => setCreating(false)} />
    </SettingsPage>
  );
}
