import {
  createMcpHandler,
  McpServer,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

import packageJson from "../../../../package.json";
import {
  type AgentOperation,
  agentOperations,
  executeAgentOperation,
} from "../../agent/public";
import { guardMcpRequest, serveAuthorized } from "./access";
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

function buildServer(): McpServer {
  const server = new McpServer({
    name: "vitroflow-experiments",
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
        const outcome = await executeAgentOperation(operation.name, args);
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
    serveAuthorized("experiments", request, (accepted) =>
      experimentsMcpHandler.fetch(accepted),
    )
  );
}
