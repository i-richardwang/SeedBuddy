import { redirect as routerRedirect } from "@tanstack/react-router";

import {
  type WorkbenchUser,
  workbenchUserSchema,
} from "../../../domain/auth/schema";
import { auth } from "../../auth/public";

/** The account behind the request's session cookie, or null when there is none. */
export async function readSession(
  headers: Headers,
): Promise<WorkbenchUser | null> {
  const session = await (await auth()).api.getSession({ headers });
  return session ? workbenchUserSchema.parse(session.user) : null;
}

/** A document redirect with a relative Location, as the server handlers answer. */
export function redirect(to: string): Response {
  return routerRedirect({ href: to, statusCode: 303 });
}
