import { AppWindow } from "lucide-react";
import { useState } from "react";

import type { describeOAuthClient } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { BrandLogo } from "../../ui/BrandLogo";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { AuthConnection } from "../../ui/kit/AuthLayout";
import { Block } from "../../ui/kit/Block";
import { Button } from "../../ui/kit/Button";
import { Flexbox } from "../../ui/kit/Flex";
import { PageSkeleton } from "../../ui/kit/PageSkeleton";
import { Skeleton } from "../../ui/kit/Skeleton";
import { Text } from "../../ui/kit/Text";
import { mcpServerLabel } from "../integrations/labels";
import { AuthPage } from "./AuthPage";
import { authClient, continuation } from "./client";

/** The client, which brings no mark of its own, joined to the product. */
const connection = (
  <AuthConnection
    client={AppWindow}
    product={<BrandLogo className="size-7" />}
  />
);

export function ConsentDecision({
  client,
}: {
  client: Awaited<ReturnType<typeof describeOAuthClient>>;
}) {
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
                {mcpServerLabel(server)}
              </Block>
            ))}
          </Flexbox>
        </Flexbox>
      ) : null}
    </AuthPage>
  );
}

/** The consent page while the client is looked up: its heading and the two decisions. */
export function ConsentDecisionSkeleton() {
  return (
    <AuthPage
      centered
      hero={connection}
      title={<Skeleton.Inline width="9em" />}
      description={<Skeleton.Inline width="16em" />}
      actions={
        <PageSkeleton>
          <Flexbox gap={12}>
            <Button block size="large" type="primary" disabled>
              {m.consent_allow()}
            </Button>
            <Button block size="large" disabled>
              {m.consent_deny()}
            </Button>
          </Flexbox>
        </PageSkeleton>
      }
    />
  );
}

/**
 * Allow and Deny. Once one is chosen, it spins and the other is disabled;
 * the skeleton holds both while there is nothing to decide yet.
 */
function ConsentDecisions({
  choice,
  onDecide,
}: {
  choice: boolean | null;
  onDecide: (accept: boolean) => void;
}) {
  return (
    <Flexbox gap={12}>
      <Button
        block
        size="large"
        type="primary"
        disabled={choice === false}
        loading={choice === true}
        onClick={() => onDecide(true)}
      >
        {m.consent_allow()}
      </Button>
      <Button
        block
        size="large"
        disabled={choice === true}
        loading={choice === false}
        onClick={() => onDecide(false)}
      >
        {m.consent_deny()}
      </Button>
    </Flexbox>
  );
}
