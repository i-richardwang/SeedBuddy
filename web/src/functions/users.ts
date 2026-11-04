import { createServerFn } from "@tanstack/react-start";

import {
  userPasswordUpdateSchema,
  userRefSchema,
  userRequestSchema,
  userRoleUpdateSchema,
  userStatusUpdateSchema,
} from "../domain/auth/schema";
import {
  createUser as createUserService,
  deleteUser,
  listUsers,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  setUserStatus,
} from "../server/auth/public";
import { requireAdministrator } from "./access";

export const getUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdministrator();
  return listUsers();
});

export const createUser = createServerFn({ method: "POST" })
  .validator(userRequestSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return createUserService(data);
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .validator(userRoleUpdateSchema)
  .handler(async ({ data }) => setUserRole(await requireAdministrator(), data));

export const updateUserPassword = createServerFn({ method: "POST" })
  .validator(userPasswordUpdateSchema)
  .handler(async ({ data }) =>
    setUserPassword(await requireAdministrator(), data),
  );

export const updateUserStatus = createServerFn({ method: "POST" })
  .validator(userStatusUpdateSchema)
  .handler(async ({ data }) =>
    setUserStatus(await requireAdministrator(), data),
  );

export const removeUserSessions = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return revokeUserSessions(data);
  });

export const removeUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) => deleteUser(await requireAdministrator(), data));
