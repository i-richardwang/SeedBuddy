import { expect, test } from "bun:test";

import { run } from "./commands";

const env = process.env;

test("a command that succeeds resolves with what it printed", async () => {
  expect(await run("/bin/sh", ["-c", "echo done"], { env })).toBe("done\n");
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
  ).rejects.toThrow("resolving\nno such package");
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
