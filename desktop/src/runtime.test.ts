import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { Runtime } from "./runtime";

const SHIPPED = { filename: "seedctl-1.0.0-py3-none-any.whl", digest: "ab12" };
const CONTENT = new TextEncoder().encode("a wheel");
const { signal } = new AbortController();

/** A stand-in for `uv` that records how it was called, then exits with `code`. */
async function recordingUv(directory: string, code: number): Promise<string> {
  const uv = path.join(directory, "uv");
  await writeFile(
    uv,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/arguments"\n` +
      `echo "$UV_TOOL_BIN_DIR" > "${directory}/bin-dir"\n` +
      `echo "no such package" >&2\nexit ${code}\n`,
  );
  await chmod(uv, 0o755);
  return uv;
}

test("installing records the package once uv has installed it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-runtime-"));
  const root = path.join(directory, "runtime");
  const runtime = new Runtime(root, await recordingUv(directory, 0));

  expect(await runtime.installed()).toBeNull();
  await runtime.install(SHIPPED, CONTENT, signal);

  expect(await runtime.installed()).toBe("ab12");
  expect(runtime.seedctl).toBe(path.join(root, "bin", "seedctl"));
  expect(await readFile(path.join(directory, "bin-dir"), "utf8")).toBe(
    `${path.join(root, "bin")}\n`,
  );
  const saved = path.join(root, "package", SHIPPED.filename);
  expect(await readFile(saved, "utf8")).toBe("a wheel");
  expect(
    (await readFile(path.join(directory, "arguments"), "utf8")).split("\n"),
  ).toContain(`seedctl[yolo] @ file://${saved}`);
});

test("an install uv fails says what uv printed and leaves nothing installed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-runtime-"));
  const root = path.join(directory, "runtime");
  await new Runtime(root, await recordingUv(directory, 0)).install(
    SHIPPED,
    CONTENT,
    signal,
  );
  const runtime = new Runtime(root, await recordingUv(directory, 2));

  await expect(
    runtime.install({ ...SHIPPED, digest: "cd34" }, CONTENT, signal),
  ).rejects.toThrow("no such package");
  expect(await runtime.installed()).toBeNull();
});
