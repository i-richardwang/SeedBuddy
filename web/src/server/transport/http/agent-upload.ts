import { classifyAgentFailure } from "../../agent/public";
import { agentFailureResponse } from "./agent";

export function agentUploadRefusal(message: string, status: number): Response {
  return agentFailureResponse("invalid_request", message, status);
}
export function agentUploadFailure(
  error: unknown,
  operation: string,
): Response {
  const failure = classifyAgentFailure(error, operation);
  return agentFailureResponse(failure.code, failure.message);
}
