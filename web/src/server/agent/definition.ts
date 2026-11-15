import type { z } from "zod";

import type { Executor } from "../infra/db/client";

interface OperationMetadata {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
}

/**
 * Transaction ownership is explicit; queries and service-owned commands
 * receive no db. Every handler is also given the account the caller acts
 * for, as the fact an operation records or reads by; whether the call may
 * proceed was decided before it reached the catalog.
 */
export type AgentOperation = OperationMetadata &
  (
    | {
        kind: "query";
        destructive: false;
        handler: (input: unknown, user: string) => Promise<unknown>;
      }
    | {
        kind: "command";
        destructive: boolean;
        transaction: "operation";
        handler: (
          input: unknown,
          db: Executor,
          user: string,
        ) => Promise<unknown>;
      }
    | {
        kind: "command";
        destructive: boolean;
        transaction: "service";
        handler: (input: unknown, user: string) => Promise<unknown>;
      }
  );

interface Definition<Input extends z.ZodType, Output extends z.ZodType> {
  name: string;
  description: string;
  input: Input;
  output: Output;
}

// A command with a null output may resolve without a value.
type Result<Output extends z.ZodType> =
  | Promise<z.input<Output>>
  | (null extends z.input<Output> ? Promise<void> : never);

type IndependentHandler<Input extends z.ZodType, Output extends z.ZodType> = (
  input: z.output<Input>,
  user: string,
) => Result<Output>;

export function query<Input extends z.ZodType, Output extends z.ZodType>(
  config: Definition<Input, Output> & {
    handler: IndependentHandler<Input, Output>;
  },
): AgentOperation {
  return {
    ...config,
    kind: "query",
    destructive: false,
    handler: (input, user) => config.handler(input as z.output<Input>, user),
  };
}

export function command<Input extends z.ZodType, Output extends z.ZodType>(
  config: Definition<Input, Output> & { destructive: boolean } & (
      | {
          transaction: "operation";
          handler: (
            input: z.output<Input>,
            db: Executor,
            user: string,
          ) => Result<Output>;
        }
      | { transaction: "service"; handler: IndependentHandler<Input, Output> }
    ),
): AgentOperation {
  if (config.transaction === "operation") {
    return {
      ...config,
      kind: "command",
      transaction: "operation",
      handler: (input, db, user) =>
        config.handler(input as z.output<Input>, db, user),
    };
  }
  return {
    ...config,
    kind: "command",
    transaction: "service",
    handler: (input, user) => config.handler(input as z.output<Input>, user),
  };
}
