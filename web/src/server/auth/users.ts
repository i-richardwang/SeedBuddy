import { asc, eq } from "drizzle-orm";

import {
  UserAccountConflictError,
  UserNotFoundError,
} from "../../domain/auth/errors";
import {
  type UserAccount,
  type UserRole,
  userAccountSchema,
  type WorkbenchUser,
} from "../../domain/auth/schema";
import { database } from "../infra/db/client";
import { users } from "../infra/db/schema";
import { auth } from "./service";

async function readUser(id: string): Promise<UserAccount> {
  const [row] = await (
    await database()
  )
    .select()
    .from(users)
    .where(eq(users.id, id));
  if (!row) throw new UserNotFoundError(`Unknown user: ${id}`);
  return toAccount(row);
}

function toAccount(row: {
  id: string;
  name: string;
  email: string;
  role?: string | null | undefined;
  banned?: boolean | null | undefined;
  createdAt: Date;
}): UserAccount {
  return userAccountSchema.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: row.banned ?? false,
    createdAt: row.createdAt.toISOString(),
  });
}

function refuseSelf(actorUser: WorkbenchUser, target: string, what: string) {
  if (actorUser.id === target) {
    throw new UserAccountConflictError(`You cannot ${what} your own account`);
  }
}

export async function listUsers(): Promise<UserAccount[]> {
  const rows = await (
    await database()
  )
    .select()
    .from(users)
    .orderBy(asc(users.name))
    .limit(500);
  return rows.map(toAccount);
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<UserAccount> {
  const { user } = await (await auth()).api.createUser({ body: input });
  return toAccount(user);
}

export async function setUserRole(
  actorUser: WorkbenchUser,
  input: { user: string; role: UserRole },
): Promise<UserAccount> {
  refuseSelf(actorUser, input.user, "change the role of");
  await readUser(input.user);
  await (
    await (
      await auth()
    ).$context
  ).internalAdapter.updateUser(input.user, { role: input.role });
  return readUser(input.user);
}

export async function setUserPassword(
  actorUser: WorkbenchUser,
  input: { user: string; password: string },
): Promise<void> {
  refuseSelf(actorUser, input.user, "reset the password of");
  await readUser(input.user);
  const context = await (await auth()).$context;
  const password = await context.password.hash(input.password);
  if (await context.internalAdapter.findCredentialAccount(input.user))
    await context.internalAdapter.updatePassword(input.user, password);
  else
    await context.internalAdapter.createAccount({
      userId: input.user,
      accountId: input.user,
      providerId: "credential",
      password,
    });
}

export async function setUserStatus(
  actorUser: WorkbenchUser,
  input: { user: string; suspended: boolean },
): Promise<UserAccount> {
  if (input.suspended) refuseSelf(actorUser, input.user, "suspend");
  await readUser(input.user);
  const context = await (await auth()).$context;
  await context.internalAdapter.updateUser(input.user, {
    banned: input.suspended,
    banReason: input.suspended ? undefined : null,
    banExpires: input.suspended ? undefined : null,
  });
  if (input.suspended)
    await context.internalAdapter.deleteUserSessions(input.user);
  return readUser(input.user);
}

export async function revokeUserSessions(input: {
  user: string;
}): Promise<void> {
  await readUser(input.user);
  await (
    await (
      await auth()
    ).$context
  ).internalAdapter.deleteUserSessions(input.user);
}

export async function deleteUser(
  actorUser: WorkbenchUser,
  input: { user: string },
): Promise<void> {
  refuseSelf(actorUser, input.user, "delete");
  await readUser(input.user);
  const context = await (await auth()).$context;
  await context.internalAdapter.deleteUserSessions(input.user);
  await context.internalAdapter.deleteUser(input.user);
}
