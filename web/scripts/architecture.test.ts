import { expect, test } from "bun:test";

import { checkArchitecture } from "./architecture";

test("dependency extraction ignores prose and checks type, static and dynamic imports", () => {
  const source = `// import { hidden } from "ignored";
 const example = 'import("also-ignored")';
 import type { Image } from "./images"; export { Image } from "./images"; export * from "./workers"; type Result = import("./results").Result; const load = () => import("./runtime");`;
  const errors = checkArchitecture(
    new Map([["src/server/agent/check.ts", source]]),
  );
  for (const name of ["images", "workers", "results", "runtime"])
    expect(errors.join("\n")).toContain(name);
  expect(errors.join("\n")).not.toContain("ignored");
});

test("business modules expose public operations, while tests may inspect internals", () => {
  const sources = new Map([
    ["src/server/images/public.ts", 'export { store } from "./store";'],
    ["src/server/images/store.ts", "export const store = () => {};"],
    [
      "src/server/datasets/memberships.ts",
      'import { store } from "../images/public";',
    ],
    [
      "src/server/datasets/memberships.test.ts",
      'import { store } from "../images/store";',
    ],
  ]);
  expect(checkArchitecture(sources)).toEqual([]);
  sources.set(
    "src/server/datasets/memberships.ts",
    'import { store } from "../images/store";',
  );
  expect(checkArchitecture(sources).join("\n")).toContain(
    "public.ts instead of its internals",
  );
});

test("page queries may compose training and datasets, but datasets must not depend back on training", () => {
  const sources = new Map([
    [
      "src/server/queries/overview.ts",
      'import "../datasets/public"; import "../training/public";',
    ],
    ["src/server/datasets/public.ts", "export {};"],
    ["src/server/training/public.ts", 'import "../datasets/public";'],
  ]);
  expect(checkArchitecture(sources)).toEqual([]);
  sources.set("src/server/datasets/public.ts", 'import "../training/public";');
  const errors = checkArchitecture(sources).join("\n");
  expect(errors).toContain("dependency direction is not allowed");
  expect(errors).toContain("Dependency cycle:");
});

test("shared browser contracts cannot reference the server, even through a type-only import", () => {
  expect(
    checkArchitecture(
      new Map([
        [
          "src/domain/images/schema.ts",
          'import type { Image } from "../../server/images/public";',
        ],
        ["src/server/images/public.ts", "export interface Image {}"],
      ]),
    ).join("\n"),
  ).toContain("shared/browser code must not import server code");
});

test("application initialization belongs to the server entry, not request authentication or browser code", () => {
  const sources = new Map([
    [
      "src/server.ts",
      'import { bootstrap } from "./server/bootstrap"; bootstrap();',
    ],
    ["src/server/bootstrap.ts", "export function bootstrap() {}"],
  ]);
  expect(checkArchitecture(sources)).toEqual([]);
  sources.set("src/start.ts", 'import "./server/bootstrap";');
  expect(checkArchitecture(sources).join("\n")).toContain(
    "public.ts instead of its internals",
  );
  sources.delete("src/start.ts");
  sources.set("src/ui/Image.tsx", 'import "../server";');
  expect(checkArchitecture(sources).join("\n")).toContain(
    "shared/browser code must not import server code",
  );
});

test("bootstrap may install builtins but database infrastructure cannot import model services", () => {
  const sources = new Map([
    ["src/server/bootstrap.ts", 'import "./models/public";'],
    ["src/server/models/public.ts", "export {};"],
  ]);
  expect(checkArchitecture(sources)).toEqual([]);
  sources.set("src/server/infra/db/client.ts", 'import "../../models/public";');
  expect(checkArchitecture(sources).join("\n")).toContain(
    "dependency direction is not allowed",
  );
});

test("production cannot import fixtures, and module internals cannot import their own public entry", () => {
  const sources = new Map([
    [
      "src/server/images/store.ts",
      'import "./public"; import "../testing/fixtures";',
    ],
    ["src/server/images/public.ts", 'export * from "./store";'],
    ["src/server/testing/fixtures.ts", "export {};"],
  ]);
  const errors = checkArchitecture(sources).join("\n");
  expect(errors).toContain("production must not import test code");
  expect(errors).toContain("not their own public entry");
  expect(errors).toContain("Dependency cycle:");
});

test("dynamic imports cannot hide dependencies and new flat server files require classification", () => {
  expect(
    checkArchitecture(
      new Map([
        ["src/server/misc.ts", "const load = (name: string) => import(name);"],
      ]),
    ).join("\n"),
  ).toContain("unclassified server module");
  expect(
    checkArchitecture(
      new Map([
        [
          "src/server/agent/check.ts",
          "const load = (name: string) => import(name);",
        ],
      ]),
    ).join("\n"),
  ).toContain("literal module specifier");
});

test("pure layers reject UI imports, browser globals and nonliteral dynamic imports", () => {
  const sources = new Map([
    [
      "src/domain/images/rules.ts",
      'import { label } from "../../ui/label"; export const value = window.location.href;',
    ],
    ["src/ui/label.ts", 'export const label = "image";'],
  ]);
  expect(checkArchitecture(sources).join("\n")).toContain("layer dependency");
  expect(checkArchitecture(sources).join("\n")).toContain(
    "must not use window",
  );
  expect(
    checkArchitecture(
      new Map([
        [
          "src/lib/load.ts",
          'const name = "x"; export const load = () => import(name);',
        ],
      ]),
    ).join("\n"),
  ).toContain("literal");
});

test("shared cycles and UI-to-feature dependencies are rejected", () => {
  const sources = new Map([
    ["src/domain/a.ts", 'import { b } from "./b"; export const a = () => b;'],
    ["src/domain/b.ts", 'import { a } from "./a"; export const b = () => a;'],
    ["src/ui/panel.ts", 'import { flow } from "../features/flow";'],
    ["src/features/flow.ts", "export const flow = 1;"],
  ]);
  const errors = checkArchitecture(sources).join("\n");
  expect(errors).toContain("Dependency cycle");
  expect(errors).toContain("layer dependency");
});

test("pure rules may name a local document but cannot access the browser document", () => {
  expect(
    checkArchitecture(
      new Map([
        [
          "src/domain/parse.ts",
          "export function parse(document: { name: string }) { return document.name; }",
        ],
      ]),
    ),
  ).toEqual([]);
  expect(
    checkArchitecture(
      new Map([
        [
          "src/domain/parse.ts",
          'export const title = globalThis["document"].title;',
        ],
      ]),
    ).join("\n"),
  ).toContain("must not use document");
});
