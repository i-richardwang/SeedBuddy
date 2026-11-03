import { Plug, Unplug } from "lucide-react";

import type { McpClient } from "../../domain/auth/integrations";
import { removeMcpClient } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Flexbox } from "../../ui/kit/Flex";
import { SettingsGroup } from "../../ui/kit/Settings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";
import { toast } from "../../ui/kit/Toast";
import { Timestamp } from "../../ui/Timestamp";
import { mcpServerLabel } from "./labels";

/** Approved MCP clients; `serversHref` leads to the server addresses a first client is given. */
export function McpClientsGroup({
  mcpClients,
  serversHref,
}: {
  mcpClients: McpClient[];
  serversHref: string;
}) {
  return (
    <SettingsGroup
      title={m.integrations_mcp_clients()}
      extra={
        mcpClients.length > 0
          ? m.mcp_client_count({ count: mcpClients.length })
          : null
      }
    >
      <Table
        narrow="cards"
        variant="borderless"
        aria-label={m.integrations_mcp_clients()}
        empty={
          mcpClients.length === 0 ? (
            <Empty
              icon={Plug}
              title={m.mcp_empty()}
              description={m.mcp_empty_description()}
              action={
                <Button render={<a href={serversHref} />}>
                  {m.mcp_empty_show_servers()}
                </Button>
              }
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableHead>{m.mcp_column_client()}</TableHead>
            <TableHead>{m.mcp_column_servers()}</TableHead>
            <TableHead>{m.mcp_column_approved()}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.api_key_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {mcpClients.map((client) => (
            <McpClientRow key={client.id} client={client} />
          ))}
        </TableBody>
      </Table>
    </SettingsGroup>
  );
}

function McpClientRow({ client }: { client: McpClient }) {
  const confirmDestructive = useConfirmDestructive();

  return (
    <TableRow>
      <TableCell cellSlot="title">{client.name}</TableCell>
      <TableCell cellLabel={m.mcp_column_servers()}>
        <Flexbox horizontal gap={4} wrap="wrap">
          {client.servers.map((server) => (
            <Tag key={server} size="small">
              {mcpServerLabel(server)}
            </Tag>
          ))}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.mcp_column_approved()}>
        <Timestamp value={client.lastGrantedAt} />
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        <ActionIcon
          icon={Unplug}
          size="small"
          title={m.mcp_disconnect()}
          onClick={() =>
            confirmDestructive({
              title: m.mcp_disconnect_title({ name: client.name }),
              confirmLabel: m.mcp_disconnect(),
              onConfirm: async () => {
                await removeMcpClient({ data: { client: client.id } });
              },
              onSuccess: () => {
                toast.success(m.mcp_disconnected({ name: client.name }));
              },
            })
          }
        />
      </TableCell>
    </TableRow>
  );
}
