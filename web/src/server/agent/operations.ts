import { z } from "zod";

import { datasetOperations } from "./datasets";
import type { AgentOperation } from "./definition";
import { experimentOperations } from "./experiments";
import { inferenceOperations } from "./inference";
import { modelOperations } from "./models";
import { trainingOperations } from "./training";

/**
 * The catalog an agent works from: one protocol-neutral list of operations,
 * which the HTTP surface and the MCP tool list both project. A name is part
 * of the public contract.
 */
const operations: readonly AgentOperation[] = [
  ...experimentOperations,
  ...datasetOperations,
  ...modelOperations,
  ...trainingOperations,
  ...inferenceOperations,
];

export const agentOperations: ReadonlyMap<string, AgentOperation> = new Map(
  operations.map((operation) => [operation.name, operation]),
);

/** A machine-readable description of every operation, for agent discovery. */
export function describeAgentOperations(): {
  name: string;
  description: string;
  kind: AgentOperation["kind"];
  destructive: boolean;
  input: unknown;
  output: unknown;
}[] {
  return [...agentOperations.values()].map(
    ({ name, description, kind, destructive, input, output }) => ({
      name,
      description,
      kind,
      destructive,
      input: z.toJSONSchema(input, { io: "input" }),
      output: z.toJSONSchema(output, { io: "output" }),
    }),
  );
}
