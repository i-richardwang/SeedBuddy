import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import {
  userCreateSchema,
  userPasswordUpdateSchema,
  userRefSchema,
  userRoleUpdateSchema,
} from "../domain/auth/schema";
import {
  banUser,
  createUser,
  deleteUser,
  listUsers,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  unbanUser,
} from "../server/auth/public";

export const getUsers = createServerFn({ method: "GET" }).handler(() =>
  listUsers(getRequestHeaders()),
);

export const addUser = createServerFn({ method: "POST" })
  .validator(userCreateSchema)
  .handler(({ data }) => createUser(getRequestHeaders(), data));

export const changeUserRole = createServerFn({ method: "POST" })
  .validator(userRoleUpdateSchema)
  .handler(({ data }) => setUserRole(getRequestHeaders(), data));

export const resetUserPassword = createServerFn({ method: "POST" })
  .validator(userPasswordUpdateSchema)
  .handler(({ data }) => setUserPassword(getRequestHeaders(), data));

export const suspendUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => banUser(getRequestHeaders(), data));

export const reinstateUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => unbanUser(getRequestHeaders(), data));

export const signOutUserEverywhere = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => revokeUserSessions(getRequestHeaders(), data));

export const removeUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => deleteUser(getRequestHeaders(), data));
