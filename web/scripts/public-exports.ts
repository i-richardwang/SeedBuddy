import { posix as path } from "node:path";

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

import { testCode } from "./architecture";

/** Public service barrels expose only names consumed outside their module. */
export function unusedPublicExports(
  sources: ReadonlyMap<string, string>,
): string[] {
  const exports = new Map<string, Set<string>>();
  const uses = new Map<string, Set<string>>();
  const targetOf = (file: string, specifier: string) =>
    path.normalize(path.join(path.dirname(file), `${specifier}.ts`));
  const use = (target: string, name: string) => {
    if (!uses.has(target)) uses.set(target, new Set());
    uses.get(target)!.add(name);
  };
  for (const [file, source] of sources) {
    if (testCode(file)) continue;
    const tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    traverse(tree, {
      ImportDeclaration(ref) {
        const target = targetOf(file, ref.node.source.value);
        for (const specifier of ref.node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            use(
              target,
              specifier.imported.type === "Identifier"
                ? specifier.imported.name
                : specifier.imported.value,
            );
          } else if (specifier.type === "ImportNamespaceSpecifier") {
            const binding = ref.scope.getBinding(specifier.local.name);
            const references = binding?.referencePaths ?? [];
            if (references.length === 0) use(target, "*");
            for (const reference of references) {
              const parent = reference.parentPath;
              if (
                parent?.isMemberExpression() &&
                !parent.node.computed &&
                parent.node.property.type === "Identifier"
              )
                use(target, parent.node.property.name);
              else use(target, "*");
            }
          } else use(target, "*");
        }
      },
      ExportNamedDeclaration(ref) {
        if (ref.node.source) {
          const target = targetOf(file, ref.node.source.value);
          for (const item of ref.node.specifiers) {
            if (item.type === "ExportSpecifier") use(target, item.local.name);
          }
        }
        if (!/^src\/server\/[^/]+\/public\.ts$/.test(file)) return;
        if (!exports.has(file)) exports.set(file, new Set());
        for (const item of ref.node.specifiers) {
          exports
            .get(file)!
            .add(
              item.exported.type === "Identifier"
                ? item.exported.name
                : item.exported.value,
            );
        }
      },
      ExportAllDeclaration(ref) {
        use(targetOf(file, ref.node.source.value), "*");
      },
      CallExpression(ref) {
        if (
          ref.node.callee.type === "Import" &&
          ref.node.arguments[0]?.type === "StringLiteral"
        )
          use(targetOf(file, ref.node.arguments[0].value), "*");
      },
    });
  }
  return [...exports].flatMap(([file, names]) =>
    [...names]
      .filter((name) => !uses.get(file)?.has(name) && !uses.get(file)?.has("*"))
      .map((name) => `${file}: unused public export ${name}`),
  );
}
