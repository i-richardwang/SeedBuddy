import { getRequestHeaders } from "@tanstack/react-start/server";
import { isAdmin } from "../domain/auth/schema";
import { readSession } from "../server/transport/http/session";

export async function requireAccount() {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

export async function requireAdministrator() {
  const user = await requireAccount();
  if (!isAdmin(user)) throw new Response("Forbidden", { status: 403 });
  return user;
}
