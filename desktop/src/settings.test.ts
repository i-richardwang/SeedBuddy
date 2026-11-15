import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { readSettings, type Settings, writeSettings } from "./settings";

const initial = (): Settings => ({
  server: null,
  workerName: "lab-mac-1a2b",
  enrolled: false,
  serving: true,
});

test("settings read back as they were written", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-settings-"));
  const file = path.join(directory, "nested", "settings.json");
  const settings = { ...initial(), server: "https://seedbuddy.example.org" };

  await writeSettings(file, settings);

  expect(await readSettings(file, initial)).toEqual(settings);
  expect(await readdir(path.dirname(file))).toEqual(["settings.json"]);
});

test("a file that holds no settings reads as the initial ones", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-settings-"));
  const file = path.join(directory, "settings.json");

  expect(await readSettings(file, initial)).toEqual(initial());
  await writeFile(file, '{"server": 3}');
  expect(await readSettings(file, initial)).toEqual(initial());
  await writeFile(file, "{");
  expect(await readSettings(file, initial)).toEqual(initial());
});
