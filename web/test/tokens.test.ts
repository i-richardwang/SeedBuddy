/**
 * The design tokens in `src/styles/app.css` and the component styles in
 * `src/ui/kit/*.css` agree with the code that reads them: every token is used,
 * every variable read is declared, every color has its dark value, and token
 * names are written in full.
 */

import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const WEB_DIR = `${import.meta.dir}/..`;
const THEME = "src/styles/app.css";

/** Custom properties Base UI sets on its parts at runtime. */
const BASE_UI_PROPERTIES = new Set([
  "--active-tab-left",
  "--active-tab-right",
  "--active-tab-width",
  "--anchor-width",
  "--available-height",
  "--available-width",
  "--collapsible-panel-height",
  "--popup-height",
  "--popup-width",
  "--positioner-height",
  "--positioner-width",
  "--transform-origin",
  "--toast-frontmost-height",
  "--toast-height",
  "--toast-index",
  "--toast-offset-y",
  "--toast-swipe-movement-x",
  "--toast-swipe-movement-y",
]);

/**
 * Colors that are the same in both schemes: the drawer mask darkens whatever
 * is under it, and selected text keeps one highlight.
 */
const SCHEME_INDEPENDENT = new Set([
  "--color-mask-drawer",
  "--color-selection",
]);

/**
 * Utilities Tailwind generates from a color token, by prefix. A token
 * `--color-x` is used when any of `bg-x`, `text-x`, `border-t-x` and so on
 * appears, with or without an opacity modifier.
 */
const COLOR_UTILITIES = [
  "bg",
  "text",
  "border",
  "border-[xytrblse]",
  "outline",
  "ring",
  "ring-offset",
  "inset-ring",
  "divide",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "accent",
  "caret",
  "decoration",
  "placeholder",
  "shadow",
  "inset-shadow",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function read(paths: string[]): Map<string, string> {
  return new Map(
    paths.map((path) => [path, readFileSync(`${WEB_DIR}/${path}`, "utf8")]),
  );
}

function glob(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: WEB_DIR })]
    .filter(
      (path) =>
        !path.startsWith("src/paraglide/") && path !== "src/routeTree.gen.ts",
    )
    .sort();
}

const css = read([THEME, ...glob("src/ui/kit/*.css")]);
const scripts = read(glob("src/**/*.{ts,tsx}"));
const theme = stripComments(css.get(THEME) ?? "");

/** The top-level blocks of a stylesheet, each with its selector and body. */
function blocks(source: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "{") {
      if (depth === 0) open = index;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        found.push({
          selector: source.slice(start, open).split(";").pop()?.trim() ?? "",
          body: source.slice(open + 1, index),
        });
        start = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      start = index + 1;
    }
  }
  return found;
}

/** Declared custom properties and their values; wildcard resets are skipped. */
function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]*);/g)].map(
      ([, name, value]) => [name ?? "", (value ?? "").trim()] as const,
    ),
  );
}

const themeBlocks = blocks(theme);
const light = new Map<string, string>();
const dark = new Map<string, string>();
for (const { selector, body } of themeBlocks) {
  if (/^@theme\b/.test(selector) || selector === ":root") {
    for (const [name, value] of declarations(body)) light.set(name, value);
  } else if (selector === ".dark") {
    for (const [name, value] of declarations(body)) dark.set(name, value);
  }
}

/** Every `var(--x)` read, by file, in CSS and scripts. */
function varReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  for (const [path, source] of [...css, ...scripts]) {
    for (const [, name] of stripComments(source).matchAll(
      /var\(\s*(--[\w-]+)/g,
    )) {
      const files = reads.get(name ?? "") ?? new Set<string>();
      files.add(path);
      reads.set(name ?? "", files);
    }
  }
  return reads;
}

/** Custom property names a script writes or reads as string literals. */
function scriptLiterals(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/["'`](--[\w-]+)["'`]/g)].map(([, name]) => name ?? ""),
  );
}

/** Text in which utility classes and variants may appear. */
const classText = [
  ...[...scripts.values()].map(stripComments),
  ...[...css.values()].map(
    (source) =>
      stripComments(source)
        .match(/@(apply|variant)[^;{]*/g)
        ?.join("\n") ?? "",
  ),
].join("\n");

function utilityUsed(prefixes: string[], name: string): boolean {
  const pattern = new RegExp(
    `(?<![\\w-])(?:${prefixes.join("|")})-${name}(?:/[\\w.]+)?(?![\\w-])`,
  );
  return pattern.test(classText);
}

/** Whether a theme token is read by a utility Tailwind generates from it. */
function readByUtility(token: string): boolean {
  const match =
    /^--(color|text|radius|breakpoint|ease|animate|font)-(.+)$/.exec(token);
  if (!match) return false;
  const [, namespace, name = ""] = match;
  switch (namespace) {
    case "color":
      return utilityUsed(COLOR_UTILITIES, name);
    case "text": {
      const size = name.replace(/--line-height$/, "");
      return utilityUsed(["text"], size);
    }
    case "radius":
      return utilityUsed(["rounded", "rounded-[trblse]{1,2}"], name);
    case "breakpoint":
      return new RegExp(
        `(?<![\\w-])(?:max-)?${name}:|@variant (?:max-)?${name}\\b`,
      ).test(classText);
    case "ease":
      return utilityUsed(["ease"], name);
    case "animate":
      return utilityUsed(["animate"], name);
    case "font":
      return utilityUsed(["font"], name);
    default:
      return false;
  }
}

describe("tokens", () => {
  test("the theme declares tokens in the blocks this test reads", () => {
    expect(light.has("--color-fg")).toBe(true);
    expect(light.has("--elevation-md")).toBe(true);
    expect(dark.has("--color-fg")).toBe(true);
  });

  test("every token in app.css is read by a variable, a script or a utility", () => {
    const reads = varReads();
    const literals = new Set(
      [...scripts.values()].flatMap((source) => [...scriptLiterals(source)]),
    );
    const unread = [...light.keys()].filter(
      (token) =>
        !reads.has(token) && !literals.has(token) && !readByUtility(token),
    );
    expect(unread).toEqual([]);
  });

  test("every variable a component declares is read", () => {
    const reads = varReads();
    const unread: string[] = [];
    for (const [path, source] of css) {
      if (path === THEME) continue;
      for (const { body } of blocks(stripComments(source))) {
        for (const name of declarations(body).keys()) {
          if (!reads.has(name)) unread.push(`${path}: ${name}`);
        }
      }
    }
    expect(unread).toEqual([]);
  });

  test("every variable read is declared", () => {
    const declaredIn = new Map<string, Set<string>>();
    const declare = (name: string, path: string) => {
      const files = declaredIn.get(name) ?? new Set<string>();
      files.add(path);
      declaredIn.set(name, files);
    };
    for (const [path, source] of css) {
      for (const [, name] of stripComments(source).matchAll(
        /(--[\w-]+)\s*:/g,
      )) {
        declare(name ?? "", path);
      }
    }
    for (const [path, source] of scripts) {
      for (const name of scriptLiterals(source)) {
        if (name.startsWith("--ui-")) declare(name, path);
      }
    }
    const component = (path: string) =>
      /^src\/ui\/kit\/(\w+)\.(css|tsx)$/.exec(path)?.[1];
    const undeclared: string[] = [];
    for (const [name, files] of varReads()) {
      if (BASE_UI_PROPERTIES.has(name)) continue;
      const owners = declaredIn.get(name);
      for (const path of files) {
        if (!owners) {
          undeclared.push(`${path}: ${name}`);
        } else if (name.startsWith("--ui-")) {
          const reader = component(path);
          const local = [...owners].some(
            (owner) => component(owner) === reader,
          );
          if (!local)
            undeclared.push(`${path}: ${name} belongs to another component`);
        }
      }
    }
    expect(undeclared).toEqual([]);
  });

  test("every color has a dark value or is derived from colors that do", () => {
    const missing = [...light]
      .filter(([token]) => token.startsWith("--color-"))
      .filter(
        ([token, value]) =>
          !dark.has(token) &&
          !SCHEME_INDEPENDENT.has(token) &&
          !value.includes("var(--color-"),
      )
      .map(([token]) => token);
    expect(missing).toEqual([]);
  });

  test("the dark scheme overrides only tokens the light scheme declares", () => {
    expect([...dark.keys()].filter((token) => !light.has(token))).toEqual([]);
  });

  test("token names are written in full, never assembled", () => {
    const assembled = [...scripts].flatMap(([path, source]) =>
      [...source.matchAll(/`--\$\{|--[\w-]*\$\{|["'`]--[\w-]*["'`]\s*\+/g)].map(
        (match) => `${path}: ${match[0]}`,
      ),
    );
    expect(assembled).toEqual([]);
  });
});
