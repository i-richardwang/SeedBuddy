import type { UserAccount } from "../../domain/auth/schema";
import { updateUserRole } from "../../functions/users";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Flexbox } from "../../ui/kit/Flex";
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
import { userStatusLabel, userStatusTone } from "./labels";
import { RoleSelect } from "./RoleSelect";
import { UserMenu } from "./UserMenu";

export function UsersTable({
  accounts,
  currentUserId,
}: {
  accounts: UserAccount[];
  currentUserId: string;
}) {
  return (
    <Table narrow="cards" aria-label={m.users_label()}>
      <TableHeader>
        <tr>
          <TableHead>{m.name_label({ kind: "person" })}</TableHead>
          <TableHead>{m.email_label()}</TableHead>
          <TableHead className="w-40">{m.role_label()}</TableHead>
          <TableHead>{m.status_label()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <UserRow
            key={account.id}
            account={account}
            self={account.id === currentUserId}
          />
        ))}
      </TableBody>
    </Table>
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
      <TableCell cellLabel={m.email_label()}>{account.email}</TableCell>
      <TableCell cellLabel={m.role_label()}>
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
      <TableCell cellLabel={m.status_label()}>
        <Status tone={userStatusTone(account)}>
          {userStatusLabel(account)}
        </Status>
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        {self ? null : <UserMenu account={account} />}
      </TableCell>
    </TableRow>
  );
}
