import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

/** Shared-transaction handlers must actually use their executor parameter. */
export function checkOperationContracts(
  sources: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  for (const [file, source] of sources) {
    if (!file.startsWith("src/server/agent/") || file.endsWith(".test.ts"))
      continue;
    const tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript"],
    });
    traverse(tree, {
      CallExpression(ref) {
        if (
          ref.node.callee.type !== "Identifier" ||
          ref.node.callee.name !== "command"
        )
          return;
        const config = ref.get("arguments.0");
        if (!config.isObjectExpression()) return;
        const properties = config.get("properties");
        const ownership = properties.find(
          (p) =>
            p.isObjectProperty() &&
            p.node.key.type === "Identifier" &&
            p.node.key.name === "transaction",
        );
        if (!ownership?.isObjectProperty()) return; // TypeScript requires explicit ownership.
        const value = ownership.node.value;
        if (value.type !== "StringLiteral" || value.value !== "operation")
          return;
        const handler = properties.find(
          (p) =>
            p.isObjectProperty() &&
            p.node.key.type === "Identifier" &&
            p.node.key.name === "handler",
        );
        const fn = handler?.isObjectProperty()
          ? handler.get("value")
          : undefined;
        const executor = fn?.isFunction() ? fn.node.params[1] : undefined;
        if (
          !fn?.isFunction() ||
          executor?.type !== "Identifier" ||
          !fn.scope.getBinding(executor.name)?.referenced
        ) {
          errors.push(
            `${file}:${ref.node.loc?.start.line}: an operation-owned command must use its executor parameter`,
          );
        }
      },
    });
  }
  return errors;
}
