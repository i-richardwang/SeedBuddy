import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

const RULES = "docs/interface.md";

/**
 * Files that draw on the image viewport, where position, scale and cursor
 * follow the pointer and the image's own coordinates at render time. Their
 * marks are drawn on the image, not set in the page's type.
 */
const DRAWING_FILES = new Set([
  "src/features/annotation/BoxLayer.tsx",
  "src/ui/viewport/ImageViewport.tsx",
]);

const STOCK_BREAKPOINTS = new Set(["sm", "md", "lg", "xl", "2xl"]);

/** Utilities that set a size, a weight or a text color of type. */
const TYPE =
  /^(text-(xs|sm|base|lg|xl|[2-9]xl|fg(-\w+)?)|font-(thin|light|normal|medium|semibold|bold|extrabold|black))$/;

/** Code that composes kit components: everything in the app outside the kit itself. */
function composes(file: string): boolean {
  return (
    /^src\/(features|routes|ui)\/.*\.tsx?$/.test(file) &&
    !file.startsWith("src/ui/kit/") &&
    !/\.test\.tsx?$/.test(file)
  );
}

/** What is wrong with one class token, if anything; a drawing may set its own type. */
function classViolation(token: string, drawing: boolean): string | null {
  const segments = token.split(":");
  const utility = (segments.pop() ?? "").replace(/^!?-?/, "");
  for (const variant of segments) {
    if (STOCK_BREAKPOINTS.has(variant.replace(/^max-/, "")))
      return `\`${token}\` uses a stock breakpoint; the layout widths are \`mobile:\` and \`laptop:\` (${RULES}, Tokens and the page environment)`;
  }
  if (!drawing && TYPE.test(utility))
    return `\`${token}\` sets type; take its size, weight and color from \`Text\` (${RULES}, Composition)`;
  if (/^(rounded|shadow)(-|$)/.test(utility))
    return `\`${token}\` draws a surface; take it from a kit component (${RULES}, Composition)`;
  if (/\[[^\]]*(\dpx|#)/.test(utility))
    return `\`${token}\` writes a raw length or color; use a token (${RULES}, Tokens and the page environment)`;
  return null;
}

function classViolations(text: string, drawing: boolean): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => classViolation(token, drawing))
    .filter((message): message is string => message !== null);
}

/**
 * Style rules for code outside the kit: classes compose semantic utilities,
 * type and surfaces come from components, and inline styles and type of
 * their own are left to drawings.
 * Paths are relative to web/.
 */
export function checkComposition(
  sources: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  for (const [file, source] of sources) {
    if (!composes(file)) continue;
    const drawing = DRAWING_FILES.has(file);
    const report = (line: number | undefined, message: string) =>
      errors.push(`${file}:${line ?? 0}: ${message}`);
    const tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    traverse(tree, {
      ImportDeclaration(ref) {
        if (ref.node.source.value.startsWith("@base-ui/react"))
          report(
            ref.node.loc?.start.line,
            `imports ${ref.node.source.value}; controls come from src/ui/kit (${RULES}, Composition)`,
          );
      },
      StringLiteral(ref) {
        if (ref.parentPath.isImportDeclaration()) return;
        for (const message of classViolations(ref.node.value, drawing))
          report(ref.node.loc?.start.line, message);
      },
      TemplateElement(ref) {
        for (const message of classViolations(
          ref.node.value.cooked ?? "",
          drawing,
        ))
          report(ref.node.loc?.start.line, message);
      },
      JSXAttribute(ref) {
        const { name, value } = ref.node;
        if (name.type !== "JSXIdentifier") return;
        if (name.name === "style" && value && !drawing)
          report(
            ref.node.loc?.start.line,
            `inline style outside a drawing; choose a component's size or variant, or a utility (${RULES}, Composition)`,
          );
      },
    });
  }
  return errors;
}
