import { spawn } from "node:child_process";

/**
 * Runs a command to its end and resolves with the end of what it printed on
 * either output, handing it `input` on standard input when given. A command
 * that fails rejects with that, and one whose `signal` aborts is ended and
 * rejects.
 */
export function run(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      signal: options.signal,
    });
    let printed = "";
    const collect = (chunk: Buffer) => {
      printed = (printed + chunk.toString("utf8")).slice(-4000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(printed);
      else
        reject(new Error(printed.trim() || `${command} exited with ${code}`));
    });
    // A command that ends without reading its input fails by how it exits.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}
