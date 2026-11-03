import type { ApiKey, McpClient, McpServerName } from "./integrations";
export interface IntegrationsDetail {
  apiKeys: ApiKey[];
  mcpClients: McpClient[];
  mcpUrls: Record<McpServerName, string>;
}
