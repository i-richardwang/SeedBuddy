import { readdirSync } from "node:fs";

import { expect, test } from "bun:test";

const WEB_DIR = `${import.meta.dir}/..`;
const MESSAGES_DIR = `${WEB_DIR}/messages`;
const LOCALES = ["en", "zh-CN"] as const;
const GENERATED_DIR = "src/paraglide/";

const modules = readdirSync(MESSAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

async function messageKeys(module: string, locale: string): Promise<string[]> {
  const bundle: Record<string, unknown> = await Bun.file(
    `${MESSAGES_DIR}/${module}/${locale}.json`,
  ).json();
  return Object.keys(bundle).filter((key) => key !== "$schema");
}

/** Every `m.<key>` the hand-written sources call. */
async function calledKeys(): Promise<Set<string>> {
  const paths = Array.from(
    new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: WEB_DIR }),
  ).filter((path) => !path.startsWith(GENERATED_DIR));
  const sources = await Promise.all(
    paths.map((path) => Bun.file(`${WEB_DIR}/${path}`).text()),
  );
  return new Set(
    sources
      .flatMap((source) => source.match(/\bm\.([a-z0-9_]+)/g) ?? [])
      .map((call) => call.slice("m.".length)),
  );
}

test("every module speaks every locale with the same keys", async () => {
  for (const module of modules) {
    const [base, ...others] = await Promise.all(
      LOCALES.map((locale) => messageKeys(module, locale)),
    );
    for (const keys of others) {
      expect(new Set(keys)).toEqual(new Set(base));
    }
  }
});

test("every message key is unique and called from a source file", async () => {
  const called = await calledKeys();
  const seen = new Set<string>();
  for (const module of modules) {
    for (const key of await messageKeys(module, "en")) {
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(called.has(key)).toBe(true);
    }
  }
});

test("message keys are sorted in every locale", async () => {
  for (const module of modules) {
    for (const locale of LOCALES) {
      const keys = await messageKeys(module, locale);
      expect(keys).toEqual([...keys].sort());
    }
  }
});

test("each English text has one key across all modules", async () => {
  const texts = new Map<string, string>();
  for (const module of modules) {
    const bundle: Record<string, unknown> = await Bun.file(
      `${MESSAGES_DIR}/${module}/en.json`,
    ).json();
    for (const [key, value] of Object.entries(bundle)) {
      if (key === "$schema") continue;
      const text = JSON.stringify(value);
      expect(
        texts.get(text),
        `${module}: ${key} duplicates ${texts.get(text)}`,
      ).toBeUndefined();
      texts.set(text, key);
    }
  }
});

// Trained and comparison image totals share one count message.
test("image and photo counts use locale numbers and singular English grammar", async () => {
  const { m } = await import("../src/paraglide/messages");
  const en = { locale: "en" } as const;
  const zh = { locale: "zh-CN" } as const;
  expect<string>(m.versions_image_count({ count: 1 }, en)).toBe("1 image");
  expect<string>(m.versions_image_count({ count: 1234 }, en)).toBe(
    "1,234 images",
  );
  expect<string>(m.versions_image_count({ count: 1234 }, zh)).toContain(
    "1,234",
  );
  expect<string>(m.observation_record_count({ count: 1 }, en)).not.toContain(
    "photos",
  );
  expect<string>(m.dataset_hero_images({ count: 1 }, en)).toBe(
    "1 image in all",
  );
  expect<string>(m.version_dialog_failed({ count: 1 }, en)).toContain(
    "image could not be read and is",
  );
  expect(
    m.version_dialog_held_out({ count: 1, hasCurrent: "no" }, en),
  ).toContain("1 reviewed image this");
  expect(
    m.version_dialog_held_out({ count: 2, hasCurrent: "yes" }, en),
  ).toContain("2 reviewed images this");
});
