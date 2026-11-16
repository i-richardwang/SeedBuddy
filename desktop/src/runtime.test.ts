import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { Runtime } from "./runtime";

const SHIPPED = {
  id: "ab12",
  filename: "seedctl-1.0.0-py3-none-any.whl",
  digest: "wheel",
  hostProtocol: 1,
  python: "3.13.14",
  requirements: "pillow==12.3.0\n",
};
const CONTENT = new TextEncoder().encode("a wheel");
const { signal } = new AbortController();

/** A stand-in for `uv` that records how it was called, then exits with `code`. */
async function recordingUv(
  directory: string,
  code: number,
  hostProtocol = 1,
): Promise<string> {
  const uv = path.join(directory, "uv");
  await writeFile(
    uv,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/arguments"\n` +
      `echo "$UV_TOOL_BIN_DIR" > "${directory}/bin-dir"\n` +
      `mkdir -p "$UV_TOOL_BIN_DIR"\ncat > "$UV_TOOL_BIN_DIR/seedctl" <<'SCRIPT'\n#!/bin/sh\necho '{"hostProtocol":${hostProtocol}}'\necho 'runtime diagnostic' >&2\nSCRIPT\nchmod +x "$UV_TOOL_BIN_DIR/seedctl"\n` +
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
  const platformRoot = path.join(root, `${process.platform}-${process.arch}`);
  expect(runtime.seedctl).toBe(
    path.join(platformRoot, "releases", SHIPPED.id, "bin", "seedctl"),
  );
  expect(await readFile(path.join(directory, "bin-dir"), "utf8")).toBe(
    `${path.join(platformRoot, "releases", SHIPPED.id, "bin")}\n`,
  );
  const saved = path.join(
    platformRoot,
    "releases",
    SHIPPED.id,
    SHIPPED.filename,
  );
  expect(await readFile(saved, "utf8")).toBe("a wheel");
  expect(
    (await readFile(path.join(directory, "arguments"), "utf8")).split("\n"),
  ).toContain(`seedctl[yolo] @ file://${saved}`);
});

test.each([
  { code: 2, hostProtocol: 1, error: "no such package" },
  {
    code: 0,
    hostProtocol: 2,
    error: "does not implement the declared host protocol",
  },
])(
  "an invalid candidate leaves the previous runtime active and runnable: $error",
  async ({ code, hostProtocol, error }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-runtime-"));
    const root = path.join(directory, "runtime");
    await new Runtime(root, await recordingUv(directory, 0)).install(
      SHIPPED,
      CONTENT,
      signal,
    );
    const runtime = new Runtime(
      root,
      await recordingUv(directory, code, hostProtocol),
    );

    await expect(
      runtime.install({ ...SHIPPED, id: "cd34" }, CONTENT, signal),
    ).rejects.toThrow(error);
    expect(await runtime.installed()).toBe(SHIPPED.id);
    expect(await Bun.file(runtime.seedctl).exists()).toBe(true);
  },
);
