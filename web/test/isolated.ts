import { expect } from "bun:test";

const WEB_DIR = `${import.meta.dir}/..`;

/**
 * Runs a DOM harness in a process of its own, since the browser globals it
 * installs are process-wide, and expects it to finish cleanly with `done`.
 */
export async function expectIsolatedRun(
  harness: string,
  args: readonly string[],
  done: string,
) {
  const child = Bun.spawn(
    [Bun.which("bun")!, "--preload", "./test/dom.ts", harness, ...args],
    {
      cwd: WEB_DIR,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(stdout).toContain(done);
}
