import { posix as path } from "node:path";

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

/** Allowed server dependencies. Public entry points are the only cross-module API. */
const dependencies: Record<string, readonly string[]> = {
  images: ["infra"],
  models: ["infra"],
  workers: ["infra"],
  auth: ["infra"],
  inference: ["images", "models", "workers", "infra"],
  "annotation-runs": ["readings", "images", "models", "infra"],
  annotations: ["images", "models", "infra"],
  datasets: ["readings", "images", "inference", "models", "infra"],
  readings: ["inference", "infra"],
  experiments: [
    "readings",
    "annotations",
    "images",
    "inference",
    "models",
    "infra",
  ],
  training: ["datasets", "models", "workers", "infra"],
  agent: [
    "inference",
    "images",
    "datasets",
    "experiments",
    "models",
    "training",
    "queries",
    "infra",
  ],
  queries: [
    "readings",
    "annotations",
    "datasets",
    "experiments",
    "images",
    "inference",
    "models",
    "training",
    "workers",
    "infra",
  ],
  transport: [
    "readings",
    "models",
    "annotation-runs",
    "agent",
    "auth",
    "datasets",
    "images",
    "inference",
    "queries",
    "training",
    "workers",
    "infra",
  ],
  maintenance: ["images", "training", "models"],
  infra: [],
  bootstrap: ["infra", "models"],
  entry: ["bootstrap"],
};

const infrastructureEntries = new Set([
  "src/server/infra/db/client.ts",
  "src/server/infra/db/connection.ts",
  "src/server/infra/db/schema.ts",
  "src/server/infra/db/errors.ts",
  "src/server/infra/blobs/store.ts",
  "src/server/infra/deployment.ts",
  "src/server/infra/digest.ts",
]);

/** Framework adapters can cross runtime boundaries; pure rules cannot. */
function layer(file: string): string | null {
  if (file === "src/start.ts" || file === "src/router.tsx") return "adapter";
  if (file === "src/server.ts") return "server";
  const match =
    /^src\/(domain|lib|features|ui|server|functions|routes|paraglide)\//.exec(
      file,
    );
  return match?.[1] ?? null;
}
const layerDependencies: Record<string, readonly string[]> = {
  domain: ["domain", "lib"],
  lib: ["lib"],
  ui: ["ui", "domain", "lib", "paraglide"],
  features: ["features", "ui", "domain", "lib", "functions", "paraglide"],
  server: ["server", "domain", "lib", "paraglide"],
  functions: ["functions", "server", "domain", "lib"],
  routes: [
    "routes",
    "functions",
    "features",
    "ui",
    "domain",
    "lib",
    "server",
    "paraglide",
  ],
  adapter: [
    "functions",
    "server",
    "domain",
    "lib",
    "routes",
    "ui",
    "paraglide",
  ],
};

/** Browser-only capabilities are forbidden in same-code server/client rules. */
function browserCapabilities(source: string): string[] {
  const found = new Set<string>();
  const forbidden = new Set([
    "window",
    "document",
    "navigator",
    "localStorage",
    "sessionStorage",
    "XMLHttpRequest",
    "FileReader",
    "HTMLElement",
    "ResizeObserver",
  ]);
  const tree = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  traverse(tree, {
    ReferencedIdentifier(ref) {
      if (forbidden.has(ref.node.name) && !ref.scope.getBinding(ref.node.name))
        found.add(ref.node.name);
    },
    MemberExpression(ref) {
      const { object, property, computed } = ref.node;
      if (
        object.type !== "Identifier" ||
        object.name !== "globalThis" ||
        ref.scope.getBinding("globalThis")
      )
        return;
      const name =
        !computed && property.type === "Identifier"
          ? property.name
          : property.type === "StringLiteral"
            ? property.value
            : null;
      if (name && forbidden.has(name)) found.add(name);
    },
  });
  return [...found];
}

function serverModule(file: string): string | null {
  if (file === "src/server.ts") return "entry";
  if (file === "src/server/bootstrap.ts") return "bootstrap";
  return file.startsWith("src/server/")
    ? file.slice("src/server/".length).split("/")[0]!
    : null;
}

export function testCode(file: string): boolean {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(file) ||
    file.startsWith("test/") ||
    file.startsWith("src/server/testing/") ||
    file.endsWith("/testing.ts")
  );
}

function adapter(file: string): boolean {
  return (
    file.startsWith("src/routes/") ||
    file.startsWith("src/functions/") ||
    file === "src/start.ts"
  );
}

function processEntry(file: string): boolean {
  return (
    file === "src/server.ts" ||
    file === "server.ts" ||
    file === "scripts/maintenance.ts" ||
    file === "scripts/analyze-images.ts" ||
    file === "scripts/collect-blobs.ts"
  );
}

/** Parse actual syntax, including type imports, re-exports and dynamic imports. */
function importSpecifiers(source: string): string[] {
  const result: string[] = [];
  const tree = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    attachComment: false,
    createImportExpressions: true,
  });
  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
        "TSImportType",
      ].includes(String(node.type))
    ) {
      const target = (node.source ?? node.argument) as
        { value?: unknown } | undefined;
      if (typeof target?.value === "string") result.push(target.value);
      else if (node.type === "ImportExpression") {
        throw new Error(
          "Dynamic imports must use a literal module specifier so their boundary can be checked",
        );
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "loc" && key !== "comments" && key !== "tokens") {
        if (Array.isArray(child)) child.forEach(walk);
        else walk(child);
      }
    }
  }
  walk(tree);
  return result;
}

function resolve(
  from: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string {
  const base = path.normalize(path.join(path.dirname(from), specifier));
  return (
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      base.replace(/\.js$/, ".ts"),
      `${base}/index.ts`,
    ].find((file) => sources.has(file)) ?? base
  );
}

/** Reports a useful cycle path, rather than just whether one exists. */
function cycles(graph: Map<string, Set<string>>): string[] {
  const complete = new Set<string>();
  const active: string[] = [];
  const errors: string[] = [];
  function visit(file: string): void {
    const at = active.indexOf(file);
    if (at >= 0) {
      errors.push(
        `Dependency cycle: ${[...active.slice(at), file].join(" -> ")}`,
      );
      return;
    }
    if (complete.has(file)) return;
    active.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    active.pop();
    complete.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return errors;
}

/** Paths are relative to web/. Tests may inspect internals; production never imports tests. */
export function checkArchitecture(
  sources: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  const files = new Map<string, Set<string>>();
  const modules = new Map<string, Set<string>>();
  for (const [file, source] of sources) {
    if (testCode(file)) continue;
    const owner = serverModule(file);
    const sourceLayer = layer(file);
    if (file.startsWith("src/") && !sourceLayer)
      errors.push(`${file}: unclassified runtime layer`);
    if (owner && !dependencies[owner])
      errors.push(`${file}: unclassified server module`);
    let imports: string[];
    try {
      imports = importSpecifiers(source);
      if (sourceLayer === "domain" || sourceLayer === "lib") {
        for (const capability of browserCapabilities(source))
          errors.push(`${file}: pure modules must not use ${capability}`);
      }
    } catch (error) {
      errors.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) {
        if (
          (sourceLayer === "domain" || sourceLayer === "lib") &&
          specifier !== "zod"
        )
          errors.push(`${file}: pure modules must not import ${specifier}`);
        continue;
      }
      const target = resolve(file, specifier, sources);
      const targetOwner = serverModule(target);
      const targetLayer = layer(target);
      const reject = (reason: string) =>
        errors.push(`${file} -> ${target}: ${reason}`);
      if (
        sourceLayer &&
        targetLayer &&
        !layerDependencies[sourceLayer]?.includes(targetLayer)
      )
        reject("layer dependency is not allowed");
      if (sources.has(target)) {
        if (!files.has(file)) files.set(file, new Set());
        files.get(file)!.add(target);
      }
      if (testCode(target)) {
        reject("production must not import test code");
        continue;
      }
      if (!targetOwner) continue;
      if (!sources.has(target))
        reject("server import does not resolve to a source file");
      if (!owner && !adapter(file) && !processEntry(file))
        reject("shared/browser code must not import server code");
      if (owner === targetOwner) {
        if (target.endsWith("/public.ts"))
          reject(
            "module internals must import each other directly, not their own public entry",
          );
        continue;
      }
      if (owner) {
        if (!dependencies[owner]?.includes(targetOwner))
          reject("dependency direction is not allowed");
        if (!modules.has(owner)) modules.set(owner, new Set());
        modules.get(owner)!.add(targetOwner);
      }
      const publicEntry = target === `src/server/${targetOwner}/public.ts`;
      const infrastructure = infrastructureEntries.has(target);
      const transport = targetOwner === "transport" && adapter(file);
      const maintenance =
        target === "src/server/maintenance/collection.ts" && processEntry(file);
      const bootstrap =
        target === "src/server/bootstrap.ts" && processEntry(file);
      if (!(
        publicEntry ||
        infrastructure ||
        transport ||
        maintenance ||
        bootstrap
      )) {
        reject("import the module's public.ts instead of its internals");
      }
    }
  }
  return [...errors, ...cycles(files), ...cycles(modules)];
}
