import type { AgentCallResult } from "./execution";
export function failure(result: AgentCallResult): {
  code: string;
  message: string;
} {
  if (result.ok) throw new Error("Operation unexpectedly succeeded");
  return { code: result.code, message: result.message };
}
