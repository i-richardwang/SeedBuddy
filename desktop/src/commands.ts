import { spawn } from "node:child_process";

/**
 * Runs an owned command group to completion. Standard output is the machine
 * response; standard error is diagnostic. Cancellation ends the group before
 * rejecting, so callers can safely reuse its installation directory.
 */
export function run(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      detached: true,
    });
    let failure: Error | null = null;
    let overdue: ReturnType<typeof setTimeout> | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          failure ??= error as Error;
      }
    };
    const abort = () => {
      terminate("SIGTERM");
      overdue = setTimeout(() => terminate("SIGKILL"), 2_000);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", (error) => {
      failure = error;
    });
    // No descendant of an installation/setup command may outlive that command.
    child.on("exit", () => terminate("SIGKILL"));
    child.on("close", (code) => {
      clearTimeout(overdue);
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) reject(options.signal.reason);
      else if (failure) reject(failure);
      else if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `${command} exited with ${code}`,
          ),
        );
    });
    // A command that ends without reading its input fails by how it exits.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}
