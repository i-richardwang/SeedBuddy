import type { z } from "zod";

import type { Executor } from "../infra/db/client";

interface OperationMetadata {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
}

/** Transaction ownership is explicit; queries and service-owned commands receive no db. */
export type AgentOperation = OperationMetadata &
  (
    | {
        kind: "query";
        destructive: false;
        handler: (input: unknown) => Promise<unknown>;
      }
    | {
        kind: "command";
        destructive: boolean;
        transaction: "operation";
        handler: (input: unknown, db: Executor) => Promise<unknown>;
      }
    | {
        kind: "command";
        destructive: boolean;
        transaction: "service";
        handler: (input: unknown) => Promise<unknown>;
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
    handler: (input) => config.handler(input as z.output<Input>),
  };
}

export function command<Input extends z.ZodType, Output extends z.ZodType>(
  config: Definition<Input, Output> & { destructive: boolean } & (
      | {
          transaction: "operation";
          handler: (input: z.output<Input>, db: Executor) => Result<Output>;
        }
      | { transaction: "service"; handler: IndependentHandler<Input, Output> }
    ),
): AgentOperation {
  if (config.transaction === "operation") {
    return {
      ...config,
      kind: "command",
      transaction: "operation",
      handler: (input, db) => config.handler(input as z.output<Input>, db),
    };
  }
  return {
    ...config,
    kind: "command",
    transaction: "service",
    handler: (input) => config.handler(input as z.output<Input>),
  };
}
