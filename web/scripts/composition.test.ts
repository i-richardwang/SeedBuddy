import { expect, test } from "bun:test";

import { checkComposition } from "./composition";

function check(file: string, source: string): string {
  return checkComposition(new Map([[file, source]])).join("\n");
}

test("feature classes compose semantic utilities and the two layout widths", () => {
  expect(
    check(
      "src/features/a/A.tsx",
      'export const A = () => <div className="grid gap-4 mobile:grid-cols-2 max-laptop:hidden text-success tabular-nums font-mono" />;',
    ),
  ).toBe("");
  expect(
    check("src/features/a/A.tsx", 'const c = cn("flex md:grid");'),
  ).toContain("stock breakpoint");
  expect(check("src/routes/a.tsx", "const c = `p-2 max-sm:hidden`;")).toContain(
    "stock breakpoint",
  );
});

test("type comes from Text", () => {
  expect(check("src/features/a/A.tsx", 'const c = "text-xs";')).toContain(
    "sets type",
  );
  expect(
    check("src/routes/a.tsx", 'const c = "truncate text-fg-tertiary";'),
  ).toContain("sets type");
  expect(check("src/ui/Thing.tsx", 'const c = "font-medium";')).toContain(
    "sets type",
  );
  expect(check("src/ui/kit/Text.tsx", 'const c = "text-xs";')).toBe("");
  expect(
    check("src/features/annotation/box-layers.tsx", 'const c = "text-sm";'),
  ).toBe("");
});

test("surfaces, raw lengths and raw colors belong to the kit", () => {
  expect(check("src/ui/Thing.tsx", 'const c = "rounded-md border";')).toContain(
    "draws a surface",
  );
  expect(check("src/ui/Thing.tsx", 'const c = "hover:shadow-lg";')).toContain(
    "draws a surface",
  );
  expect(check("src/ui/Thing.tsx", 'const c = "w-[12px]";')).toContain(
    "raw length or color",
  );
  expect(check("src/ui/Thing.tsx", 'const c = "bg-[#fff]";')).toContain(
    "raw length or color",
  );
  expect(check("src/ui/kit/Card.tsx", 'const c = "rounded-md";')).toBe("");
});

test("controls come from the kit and inline styles are left to drawings", () => {
  expect(
    check(
      "src/features/a/A.tsx",
      'import { Dialog } from "@base-ui/react/dialog";',
    ),
  ).toContain("controls come from src/ui/kit");
  expect(
    check(
      "src/features/a/A.tsx",
      "const A = () => <div style={{ width: 4 }} />;",
    ),
  ).toContain("inline style");
  expect(
    check(
      "src/ui/viewport/ImageViewport.tsx",
      "const A = () => <div style={{ width: 4 }} />;",
    ),
  ).toBe("");
});
