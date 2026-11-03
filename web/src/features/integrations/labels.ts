import type { ApiScope, McpServerName } from "../../domain/auth/integrations";
import { m } from "../../paraglide/messages";

const API_SCOPE_LABELS = {
  experiments: m.api_key_scope_experiments,
  annotation: m.api_key_scope_annotation,
  transfer: m.api_key_scope_transfer,
} as const satisfies Record<ApiScope, () => string>;

const MCP_SERVER_LABELS = {
  experiments: m.mcp_server_experiments,
  annotation: m.mcp_server_annotation,
} as const satisfies Record<McpServerName, () => string>;

export function apiScopeLabel(value: ApiScope): string {
  return API_SCOPE_LABELS[value]();
}

export function mcpServerLabel(value: McpServerName): string {
  return MCP_SERVER_LABELS[value]();
}
