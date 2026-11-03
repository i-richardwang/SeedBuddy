import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plug, Plus } from "lucide-react";

import { MCP_SERVERS } from "../../domain/auth/integrations";
import { ApiKeysGroup } from "../../features/integrations/ApiKeysGroup";
import { mcpServerLabel } from "../../features/integrations/labels";
import { McpClientsGroup } from "../../features/integrations/McpClientsGroup";
import { getIntegrations } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { CopyButton } from "../../ui/kit/CopyButton";
import { Empty } from "../../ui/kit/Empty";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import {
  SettingsGroup,
  SettingsGroupSkeleton,
  SettingsValueRow,
} from "../../ui/kit/Settings";
import { Text } from "../../ui/kit/Text";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";

const MCP_SERVERS_ID = "mcp-servers";

export const Route = createFileRoute("/_workbench/integrations")({
  loader: () => getIntegrations(),
  staticData: { crumbs: () => [{ label: m.integrations_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.integrations_title()) }],
  }),
  pendingComponent: () => (
    <SettingsPageSkeleton>
      <SettingsGroupSkeleton>
        <TableSkeleton rows={2} />
      </SettingsGroupSkeleton>
      <SettingsGroupSkeleton rows={MCP_SERVERS.length} />
      <SettingsGroupSkeleton>
        <TableSkeleton rows={2} />
      </SettingsGroupSkeleton>
    </SettingsPageSkeleton>
  ),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { apiKeys, mcpClients, mcpUrls } = Route.useLoaderData();

  return (
    <SettingsPage title={m.integrations_title()}>
      <ApiKeysGroup
        apiKeys={apiKeys}
        empty={(create) => (
          <Empty
            icon={KeyRound}
            title={m.api_key_empty()}
            description={m.api_key_empty_description()}
            action={
              <Button type="primary" icon={Plus} onClick={create}>
                {m.integrations_new_key()}
              </Button>
            }
          />
        )}
      />
      <SettingsGroup id={MCP_SERVERS_ID} title={m.integrations_mcp_servers()}>
        {MCP_SERVERS.map((server) => (
          <SettingsValueRow
            key={server}
            label={mcpServerLabel(server)}
            action={<CopyButton content={mcpUrls[server]} />}
          >
            <Text as="code" size="xs" title={mcpUrls[server]}>
              {mcpUrls[server]}
            </Text>
          </SettingsValueRow>
        ))}
      </SettingsGroup>
      <McpClientsGroup
        mcpClients={mcpClients}
        empty={
          <Empty
            icon={Plug}
            title={m.mcp_empty()}
            description={m.mcp_empty_description()}
            action={
              <Button render={<a href={`#${MCP_SERVERS_ID}`} />}>
                {m.mcp_empty_show_servers()}
              </Button>
            }
          />
        }
      />
    </SettingsPage>
  );
}
