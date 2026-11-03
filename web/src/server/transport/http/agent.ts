import {
  type AgentFailureCode,
  describeAgentOperations,
  executeAgentOperation,
} from "../../agent/public";
import { authorizeApiKey } from "../../auth/public";

type HttpFailureCode = AgentFailureCode | "unauthorized";

const statusByFailure: Record<HttpFailureCode, 400 | 401 | 404 | 409 | 500> = {
  unauthorized: 401,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
};

export function agentFailureResponse(
  code: HttpFailureCode,
  message: string,
  status: number = statusByFailure[code],
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** The refusal a request without a live experiments-scoped API key gets, or null. */
export async function refuseWithoutAgentKey(
  request: Request,
): Promise<Response | null> {
  return (await authorizeApiKey(request, "experiments"))
    ? null
    : agentFailureResponse(
        "unauthorized",
        "An API key with the experiments scope is required",
      );
}

async function handleAgentOperationCall(
  operation: string,
  request: Request,
): Promise<Response> {
  let input: unknown = {};
  const body = await request.text();
  if (body) {
    try {
      input = JSON.parse(body);
    } catch {
      return agentFailureResponse(
        "invalid_request",
        "Request body must be JSON",
      );
    }
  }
  const outcome = await executeAgentOperation(operation, input);
  return outcome.ok
    ? Response.json({ result: outcome.output })
    : agentFailureResponse(outcome.code, outcome.message);
}

export async function serveAgentOperationCall(
  operation: string,
  request: Request,
): Promise<Response> {
  return (
    (await refuseWithoutAgentKey(request)) ??
    handleAgentOperationCall(operation, request)
  );
}

function handleAgentInterface(): Response {
  return Response.json({
    call: "POST /api/agent/<name> with the operation's JSON input",
    upload:
      "POST image bytes to /api/agent/images to obtain the digest create-observation and assign-images-to-observation expect",
    operations: describeAgentOperations(),
  });
}

export async function serveAgentInterface(request: Request): Promise<Response> {
  return (await refuseWithoutAgentKey(request)) ?? handleAgentInterface();
}
