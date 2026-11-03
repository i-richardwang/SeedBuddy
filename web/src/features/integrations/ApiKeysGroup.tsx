import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { ApiKey } from "../../domain/auth/integrations";
import { removeApiKey } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
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
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { Timestamp } from "../../ui/Timestamp";
import { apiScopeLabel } from "./labels";
import { NewApiKeyDialog } from "./NewApiKeyDialog";

/** The reader's API keys, and the one place a new key is created. */
export function ApiKeysGroup({
  apiKeys,
  empty,
}: {
  apiKeys: ApiKey[];
  empty: (create: () => void) => ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const create = () => setCreating(true);

  return (
    <>
      <SettingsGroup
        title={m.integrations_api_keys()}
        extra={
          apiKeys.length > 0 ? (
            <>
              {m.api_key_count({ count: apiKeys.length })}
              <Button size="small" icon={Plus} onClick={create}>
                {m.integrations_new_key()}
              </Button>
            </>
          ) : null
        }
      >
        <Table
          narrow="cards"
          variant="borderless"
          aria-label={m.integrations_api_keys()}
          empty={apiKeys.length === 0 ? empty(create) : undefined}
        >
          <TableHeader>
            <tr>
              <TableHead>{m.name_label({ kind: "thing" })}</TableHead>
              <TableHead>{m.api_key_column_key()}</TableHead>
              <TableHead>{m.scopes_label()}</TableHead>
              <TableHead>{m.api_key_column_expires()}</TableHead>
              <TableHead>{m.api_key_column_last_used()}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{m.column_actions()}</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {apiKeys.map((apiKey) => (
              <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
            ))}
          </TableBody>
        </Table>
      </SettingsGroup>
      <NewApiKeyDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const confirmDestructive = useConfirmDestructive();
  const expired =
    apiKey.expiresAt !== null && new Date(apiKey.expiresAt) <= new Date();

  return (
    <TableRow>
      <TableCell cellSlot="title">{apiKey.name}</TableCell>
      <TableCell cellLabel={m.api_key_column_key()}>
        <Text as="span" size="xs" className="font-mono">
          {m.api_key_start({ start: apiKey.start })}
        </Text>
      </TableCell>
      <TableCell cellLabel={m.scopes_label()}>
        <Flexbox horizontal gap={4} wrap="wrap">
          {apiKey.scopes.map((scope) => (
            <Tag key={scope} size="small">
              {apiScopeLabel(scope)}
            </Tag>
          ))}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.api_key_column_expires()}>
        {apiKey.expiresAt === null ? (
          m.api_key_expiry_never()
        ) : expired ? (
          <Text as="span" type="error">
            {m.api_key_expired()}
          </Text>
        ) : (
          <Timestamp value={apiKey.expiresAt} />
        )}
      </TableCell>
      <TableCell cellLabel={m.api_key_column_last_used()}>
        {apiKey.lastUsedAt === null ? (
          m.api_key_never_used()
        ) : (
          <Timestamp value={apiKey.lastUsedAt} />
        )}
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        <ActionIcon
          icon={Trash2}
          size="small"
          title={m.api_key_revoke()}
          onClick={() =>
            confirmDestructive({
              title: m.api_key_revoke_title({ name: apiKey.name }),
              confirmLabel: m.api_key_revoke(),
              onConfirm: async () => {
                await removeApiKey({ data: { key: apiKey.id } });
              },
              onSuccess: () => {
                toast.success(m.api_key_revoked({ name: apiKey.name }));
              },
            })
          }
        />
      </TableCell>
    </TableRow>
  );
}
