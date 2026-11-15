import {
  createMcpHandler,
  type McpRequestContext,
  McpServer,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import packageJson from "../../../../package.json";
import {
  type AgentOperation,
  agentOperations,
  executeAgentOperation,
} from "../../agent/public";
import { admittedAccount, guardMcpRequest, serveAuthorized } from "./access";
import { mcpErrorContent } from "./errors";

/**
 * The experiment MCP server: the MCP face of the agent operations. Every tool
 * is one registry entry, so the tool list cannot drift from the HTTP surface.
 */
function toolAnnotations(operation: AgentOperation): ToolAnnotations {
  return operation.kind === "query"
    ? { readOnlyHint: true, openWorldHint: false }
    : { destructiveHint: operation.destructive, openWorldHint: false };
}

/** Every tool runs for the account the request's credential acts for. */
function buildServer({ authInfo }: McpRequestContext): McpServer {
  const user = admittedAccount(authInfo);
  const server = new McpServer({
    name: "seedbuddy-experiments",
    version: packageJson.version,
  });
  for (const operation of agentOperations.values()) {
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.input,
        outputSchema: operation.output,
        annotations: toolAnnotations(operation),
      },
      async (args) => {
        const outcome = await executeAgentOperation(operation.name, args, user);
        if (!outcome.ok) {
          return mcpErrorContent(outcome);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(outcome.output) }],
          structuredContent: outcome.output,
        };
      },
    );
  }
  return server;
}

const experimentsMcpHandler = createMcpHandler(buildServer, {
  legacy: "stateless",
});

/** The experiment server opens to an account's MCP clients and API keys. */
export async function serveExperimentsMcp(request: Request): Promise<Response> {
  return (
    guardMcpRequest(request) ??
    serveAuthorized("experiments", request, experimentsMcpHandler)
  );
}
