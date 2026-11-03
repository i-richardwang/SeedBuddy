import { expect, test } from "bun:test";
import { checkOperationContracts } from "./operation-contracts";

const check = (handler: string, transaction = "operation") =>
  checkOperationContracts(
    new Map([
      [
        "src/server/agent/models.ts",
        `command({ transaction: "${transaction}", handler: ${handler} });`,
      ],
    ]),
  );
test("shared commands consume their executor; service commands need none", () => {
  expect(check("(input) => save(input)")).toHaveLength(1);
  expect(check("(input, tx) => save(input)")).toHaveLength(1);
  expect(check("(input, tx) => save(input, tx)")).toEqual([]);
  expect(check("(input) => save(input)", "service")).toEqual([]);
  expect(
    check(
      "(input, tx) => { const nested = (tx) => tx; return save(input, nested(null)); }",
    ),
  ).toHaveLength(1);
});
