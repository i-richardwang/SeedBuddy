import { createFileRoute } from "@tanstack/react-router";
import { AppWindow } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { AuthPage } from "../features/account/AuthPage";
import { authClient, continuation } from "../features/account/client";
import { MCP_SERVER_LABELS } from "../features/integrations/labels";
import { describeOAuthClient } from "../functions/integrations";
import { m } from "../paraglide/messages";
import { BrandLogo } from "../ui/BrandLogo";
import { documentTitle } from "../ui/documentTitle";
import { useAsyncAction } from "../ui/hooks/useAsyncAction";
import { AuthConnection } from "../ui/kit/AuthLayout";
import { Block } from "../ui/kit/Block";
import { Button } from "../ui/kit/Button";
import { Flexbox } from "../ui/kit/Flex";
import { PageSkeleton } from "../ui/kit/PageSkeleton";
import { Skeleton } from "../ui/kit/Skeleton";
import { Text } from "../ui/kit/Text";

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
  loader: ({ deps }) => describeOAuthClient({ data: deps }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData && m.consent_title({ client: loaderData.name }),
        ),
      },
    ],
  }),
  pendingComponent: ConsentPending,
  component: ConsentPage,
  notFoundComponent: UnknownClientPage,
});

/** The client, which brings no mark of its own, joined to the product. */
const connection = (
  <AuthConnection
    client={AppWindow}
    product={<BrandLogo className="size-7" />}
  />
);

function ConsentPage() {
  const client = Route.useLoaderData();
  const { busy, run } = useAsyncAction();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [decided, setDecided] = useState(false);
  const pending = busy || decided;

  const decide = (accept: boolean) => {
    setChoice(accept);
    void run(
      async () => {
        const { data, error } = await authClient.oauth2.consent({ accept });
        if (error) throw new Error(error.message ?? m.consent_failed());
        const next = continuation(data);
        if (!next) throw new Error(m.consent_expired());
        return next;
      },
      m.consent_failed(),
      {
        invalidate: false,
        onSuccess: (next) => {
          window.location.assign(next);
          setDecided(true);
        },
      },
    );
  };

  return (
    <AuthPage
      centered
      hero={connection}
      title={m.consent_title({ client: client.name })}
      description={
        <Flexbox gap={4} align="center">
          {m.consent_description({
            client: client.name,
            product: m.app_name(),
          })}
          {client.uri ? (
            <Text
              as="span"
              size="xs"
              type="tertiary"
              weight="regular"
              className="break-all"
            >
              {client.uri}
            </Text>
          ) : null}
        </Flexbox>
      }
      actions={
        <ConsentDecisions choice={pending ? choice : null} onDecide={decide} />
      }
    >
      {client.servers.length > 0 ? (
        <Flexbox gap={8}>
          <Text as="span" size="lg" type="secondary">
            {m.consent_servers()}
          </Text>
          <Flexbox gap={4}>
            {client.servers.map((server) => (
              <Block key={server} padding={16} variant="filled">
                {MCP_SERVER_LABELS[server]()}
              </Block>
            ))}
          </Flexbox>
        </Flexbox>
      ) : null}
    </AuthPage>
  );
}

/** The consent page while the client is looked up: its heading and the two decisions. */
function ConsentPending() {
  return (
    <AuthPage
      centered
      hero={connection}
      title={<Skeleton.Inline width="9em" />}
      description={<Skeleton.Inline width="16em" />}
      actions={
        <PageSkeleton>
          <ConsentDecisions disabled />
        </PageSkeleton>
      }
    />
  );
}

/**
 * Allow and Deny. Once one is chosen, it spins and the other is disabled;
 * `disabled` holds both while there is nothing to decide yet.
 */
function ConsentDecisions({
  choice = null,
  disabled,
  onDecide,
}: {
  choice?: boolean | null;
  disabled?: boolean;
  onDecide?: (accept: boolean) => void;
}) {
  return (
    <Flexbox gap={12}>
      <Button
        block
        size="large"
        type="primary"
        disabled={disabled || choice === false}
        loading={choice === true}
        onClick={() => onDecide?.(true)}
      >
        {m.consent_allow()}
      </Button>
      <Button
        block
        size="large"
        disabled={disabled || choice === true}
        loading={choice === false}
        onClick={() => onDecide?.(false)}
      >
        {m.consent_deny()}
      </Button>
    </Flexbox>
  );
}

function UnknownClientPage() {
  return (
    <AuthPage
      title={m.consent_unknown_client()}
      description={m.consent_unknown_client_description()}
    />
  );
}
