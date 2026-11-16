import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { expect, test } from "bun:test";

import { run } from "./commands";

const env = process.env;

test("a command that succeeds resolves with what it printed", async () => {
  expect(
    await run("/bin/sh", ["-c", "echo done; echo warning >&2"], { env }),
  ).toEqual({ stdout: "done\n", stderr: "warning\n" });
});

test("a command reads the input it is handed", async () => {
  await run("/bin/sh", ["-c", 'read line; test "$line" = token'], {
    env,
    input: "token\n",
  });
});

test("a command that fails rejects with what it printed", async () => {
  await expect(
    run("/bin/sh", ["-c", "echo resolving; echo no such package >&2; exit 2"], {
      env,
    }),
  ).rejects.toThrow("no such package");
});

test("a command that prints nothing fails by its exit code", async () => {
  await expect(run("/bin/sh", ["-c", "exit 3"], { env })).rejects.toThrow(
    "/bin/sh exited with 3",
  );
});

test("a command that cannot start rejects", async () => {
  await expect(run("/no/such/command", [], { env })).rejects.toThrow("ENOENT");
});

test("a command whose signal aborts is ended", async () => {
  const abort = new AbortController();
  const running = run("/bin/sh", ["-c", "sleep 30"], {
    env,
    signal: abort.signal,
  });

  abort.abort();

  await expect(running).rejects.toThrow("aborted");
});

test("cancellation does not resolve until a TERM-ignoring command has exited", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seedbuddy-cancel-"));
  const pidFile = path.join(directory, "pid");
  const abort = new AbortController();
  const running = run(
    "/bin/sh",
    ["-c", `trap '' TERM; echo $$ > '${pidFile}'; while :; do sleep 1; done`],
    { env, signal: abort.signal },
  );
  try {
    while (!(await Bun.file(pidFile).exists())) await wait(10);
    const pid = Number(await readFile(pidFile, "utf8"));
    abort.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    abort.abort();
    await running.catch(() => {});
    await rm(directory, { recursive: true });
  }
});
