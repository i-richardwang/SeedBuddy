import { eq } from "drizzle-orm";

import { UserNotFoundError, UserRejectedError } from "../../domain/auth/errors";
import {
  type UserAccount,
  type UserRole,
  userAccountSchema,
  type WorkbenchUser,
  workbenchUserSchema,
} from "../../domain/auth/schema";
import { database } from "../infra/db/client";
import { users } from "../infra/db/schema";
import { auth } from "./service";

/**
 * The account directory an administrator maintains. Every call carries the
 * administrator's request headers so Better Auth authorizes it as that
 * session. On top of its checks, the directory refuses an administrator
 * changing the role of, suspending, or deleting their own account, which
 * also keeps at least one administrator able to sign in.
 */

async function api() {
  return (await auth()).api;
}

async function actor(headers: Headers): Promise<WorkbenchUser> {
  const session = await (await api()).getSession({ headers });
  if (!session) throw new UserRejectedError("Sign in to maintain accounts");
  return workbenchUserSchema.parse(session.user);
}

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
    throw new UserRejectedError(`You cannot ${what} your own account`);
  }
}

export async function listUsers(headers: Headers): Promise<UserAccount[]> {
  const { users: rows } = await (
    await api()
  ).listUsers({
    headers,
    query: { limit: 500, sortBy: "name", sortDirection: "asc" },
  });
  return rows.map(toAccount);
}

export async function createUser(
  headers: Headers,
  input: { name: string; email: string; password: string; role: UserRole },
): Promise<UserAccount> {
  const { user } = await (await api()).createUser({ headers, body: input });
  return toAccount(user);
}

export async function setUserRole(
  headers: Headers,
  input: { user: string; role: UserRole },
): Promise<UserAccount> {
  refuseSelf(await actor(headers), input.user, "change the role of");
  await readUser(input.user);
  await (
    await api()
  ).setRole({ headers, body: { userId: input.user, role: input.role } });
  return readUser(input.user);
}

export async function setUserPassword(
  headers: Headers,
  input: { user: string; password: string },
): Promise<void> {
  refuseSelf(await actor(headers), input.user, "reset the password of");
  await readUser(input.user);
  await (
    await api()
  ).setUserPassword({
    headers,
    body: { userId: input.user, newPassword: input.password },
  });
}

export async function banUser(
  headers: Headers,
  input: { user: string },
): Promise<UserAccount> {
  refuseSelf(await actor(headers), input.user, "suspend");
  await readUser(input.user);
  await (await api()).banUser({ headers, body: { userId: input.user } });
  return readUser(input.user);
}

export async function unbanUser(
  headers: Headers,
  input: { user: string },
): Promise<UserAccount> {
  await readUser(input.user);
  await (await api()).unbanUser({ headers, body: { userId: input.user } });
  return readUser(input.user);
}

export async function revokeUserSessions(
  headers: Headers,
  input: { user: string },
): Promise<void> {
  await readUser(input.user);
  await (
    await api()
  ).revokeUserSessions({ headers, body: { userId: input.user } });
}

export async function deleteUser(
  headers: Headers,
  input: { user: string },
): Promise<void> {
  refuseSelf(await actor(headers), input.user, "delete");
  await readUser(input.user);
  await (await api()).removeUser({ headers, body: { userId: input.user } });
}
