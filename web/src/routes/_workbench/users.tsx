import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { isAdmin, type UserAccount } from "../../domain/auth/schema";
import { NewUserDialog } from "../../features/users/NewUserDialog";
import { RoleSelect } from "../../features/users/RoleSelect";
import { UserMenu } from "../../features/users/UserMenu";
import { getUsers, updateUserRole } from "../../functions/users";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Button } from "../../ui/kit/Button";
import { Flexbox } from "../../ui/kit/Flex";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";

const workbench = getRouteApi("/_workbench");

export const Route = createFileRoute("/_workbench/users")({
  loader: async ({ parentMatchPromise }) => {
    const { loaderData } = await parentMatchPromise;
    if (!loaderData || !isAdmin(loaderData.user)) throw notFound();
    return getUsers();
  },
  staticData: { crumbs: () => [{ label: m.users_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.users_title()) }],
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
      title={m.users_title()}
      actions={
        <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
          {m.users_new()}
        </Button>
      }
    >
      <Table narrow="cards" aria-label={m.users_title()}>
        <TableHeader>
          <tr>
            <TableHead>{m.users_column_name()}</TableHead>
            <TableHead>{m.users_column_email()}</TableHead>
            <TableHead className="w-40">{m.users_column_role()}</TableHead>
            <TableHead>{m.users_column_status()}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.users_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <UserRow
              key={account.id}
              account={account}
              self={account.id === me.id}
            />
          ))}
        </TableBody>
      </Table>
      <NewUserDialog open={creating} onClose={() => setCreating(false)} />
    </SettingsPage>
  );
}

function UserRow({ account, self }: { account: UserAccount; self: boolean }) {
  const { busy, run } = useAsyncAction();

  return (
    <TableRow>
      <TableCell cellSlot="title">
        <Flexbox horizontal align="center" gap={8}>
          {account.name}
          {self ? <Tag size="small">{m.users_you()}</Tag> : null}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.users_column_email()}>{account.email}</TableCell>
      <TableCell cellLabel={m.users_column_role()}>
        <RoleSelect
          aria-label={m.user_role_of({ name: account.name })}
          value={account.role}
          size="small"
          variant="borderless"
          disabled={self || busy}
          onChange={(role) => {
            if (role === account.role) return;
            void run(
              () => updateUserRole({ data: { user: account.id, role } }),
              m.user_role_not_changed(),
            );
          }}
        />
      </TableCell>
      <TableCell cellLabel={m.users_column_status()}>
        <Status tone={account.banned ? "warning" : "success"}>
          {account.banned ? m.user_status_suspended() : m.user_status_active()}
        </Status>
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        {self ? null : <UserMenu account={account} />}
      </TableCell>
    </TableRow>
  );
}
