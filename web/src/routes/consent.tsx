import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  ConsentDecision,
  ConsentDecisionSkeleton,
} from "../features/account/ConsentDecision";
import { getOAuthClient } from "../functions/integrations";
import { m } from "../paraglide/messages";
import { AuthPage } from "../ui/AuthPage";
import { documentTitle } from "../ui/documentTitle";

/**
 * The consent step of an MCP client's authorization request. The signed
 * request stays in the page's query; the auth client forwards it with the
 * decision, and the authorization server answers with where to go next.
 */
export const Route = createFileRoute("/consent")({
  validateSearch: z
    .object({
      client_id: z.string(),
      resource: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .loose(),
  loaderDeps: ({ search }) => ({
    clientId: search.client_id,
    resources: [search.resource ?? []].flat(),
  }),
  loader: ({ deps }) => getOAuthClient({ data: deps }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData && m.consent_title({ client: loaderData.name }),
        ),
      },
    ],
  }),
  pendingComponent: ConsentDecisionSkeleton,
  component: ConsentPage,
  notFoundComponent: UnknownClientPage,
});

function ConsentPage() {
  return <ConsentDecision client={Route.useLoaderData()} />;
}

function UnknownClientPage() {
  return (
    <AuthPage
      title={m.consent_unknown_client()}
      description={m.consent_unknown_client_description()}
    />
  );
}
