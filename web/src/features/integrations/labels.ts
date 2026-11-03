import type { ApiScope, McpServerName } from "../../domain/auth/integrations";
import { m } from "../../paraglide/messages";

export const API_SCOPE_LABELS: Record<ApiScope, () => string> = {
  experiments: m.api_key_scope_experiments,
  annotation: m.api_key_scope_annotation,
  transfer: m.api_key_scope_transfer,
};

export const MCP_SERVER_LABELS: Record<McpServerName, () => string> = {
  experiments: m.mcp_server_experiments,
  annotation: m.mcp_server_annotation,
};
