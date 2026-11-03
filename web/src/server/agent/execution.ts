import { z } from "zod";

import { transaction } from "../infra/db/client";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../domain/errors";
import type { AgentOperation } from "./definition";
import { agentOperations } from "./operations";

export type AgentFailureCode =
  "invalid_request" | "not_found" | "conflict" | "internal_error";

export type AgentCallResult =
  | { ok: true; output: unknown }
  | { ok: false; code: AgentFailureCode; message: string };

interface PreparedOperation {
  operation: AgentOperation;
  input: unknown;
}

function failure(code: AgentFailureCode, message: string): AgentCallResult {
  return { ok: false, code, message };
}

function prepareOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation>,
): PreparedOperation | AgentCallResult {
  const operation = registry.get(name);
  if (!operation) {
    return failure(
      "not_found",
      `Unknown operation: ${name}. Known operations: ${[...registry.keys()].join(", ")}`,
    );
  }
  const parsed = operation.input.safeParse(input);
  return parsed.success
    ? { operation, input: parsed.data }
    : failure("invalid_request", z.prettifyError(parsed.error));
}

/**
 * The execution boundary both protocol faces share: it parses the input
 * against the operation's schema, runs a command in one transaction that a
 * failure rolls back whole, classifies a failure by the domain error that
 * raised it, and checks the result against the published output contract
 * before it leaves.
 */
export async function executeAgentOperation(
  name: string,
  input: unknown,
  registry: ReadonlyMap<string, AgentOperation> = agentOperations,
): Promise<AgentCallResult> {
  const prepared = prepareOperation(name, input, registry);
  if ("ok" in prepared) return prepared;
  const { operation, input: parsed } = prepared;
  try {
    const validate = (value: unknown) => operation.output.parse(value ?? null);
    const output =
      operation.kind === "command" && operation.transaction === "operation"
        ? await transaction(async (tx) =>
            validate(await operation.handler(parsed, tx)),
          )
        : validate(await operation.handler(parsed));
    return { ok: true, output };
  } catch (error) {
    if (error instanceof ValidationError)
      return failure("invalid_request", error.message);
    if (error instanceof NotFoundError) {
      return failure("not_found", error.message);
    }
    if (error instanceof ConflictError) {
      return failure("conflict", error.message);
    }
    console.error(`Agent operation ${operation.name} failed:`, error);
    return failure("internal_error", "Internal error");
  }
}
