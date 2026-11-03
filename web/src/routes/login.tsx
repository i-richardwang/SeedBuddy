import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  carriesAuthorizationRequest,
  returnPath,
} from "../domain/auth/navigation";
import { SignInForm } from "../features/account/SignInForm";
import { m } from "../paraglide/messages";
import { readSession, redirect } from "../server/transport/http/session";
import { documentTitle } from "../ui/documentTitle";

/**
 * A signed-in visitor is sent on to their destination, unless the visit is
 * an OAuth authorization request that asked for a fresh sign-in: the query
 * on the page is what resumes that request once they sign in again.
 */
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }).loose(),
  head: () => ({
    meta: [{ title: documentTitle(m.login_heading({ app: m.app_name() })) }],
  }),
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        const { searchParams } = new URL(request.url);
        if (carriesAuthorizationRequest(searchParams)) return next();
        return (await readSession(request.headers))
          ? redirect(returnPath(searchParams.get("returnTo")))
          : next();
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { returnTo } = Route.useSearch();
  return <SignInForm destination={returnPath(returnTo)} />;
}
