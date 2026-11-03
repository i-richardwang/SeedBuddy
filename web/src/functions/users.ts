import { createServerFn } from "@tanstack/react-start";

import {
  userCreateSchema,
  userPasswordUpdateSchema,
  userRefSchema,
  userRoleUpdateSchema,
} from "../domain/auth/schema";
import * as authService from "../server/auth/public";
import { requireAdministrator } from "./access";

export const getUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdministrator();
  return authService.listUsers();
});

export const createUser = createServerFn({ method: "POST" })
  .validator(userCreateSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return authService.createUser(data);
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .validator(userRoleUpdateSchema)
  .handler(async ({ data }) =>
    authService.setUserRole(await requireAdministrator(), data),
  );

export const updateUserPassword = createServerFn({ method: "POST" })
  .validator(userPasswordUpdateSchema)
  .handler(async ({ data }) =>
    authService.setUserPassword(await requireAdministrator(), data),
  );

export const updateUserSuspension = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) =>
    authService.banUser(await requireAdministrator(), data),
  );

export const updateUserReinstatement = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return authService.unbanUser(data);
  });

export const removeUserSessions = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return authService.revokeUserSessions(data);
  });

export const removeUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(async ({ data }) =>
    authService.deleteUser(await requireAdministrator(), data),
  );
