import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { run } from "./commands";

/** What a Worker process is doing or how it left off, as `seedctl` records it. */
export interface WorkerStatus {
  /**
   * `starting`, `running` or `training` while it serves; `stopped`, `failed`,
   * `unenrolled`, `suspended` or `incompatible` once it has ended. The
   * package the workbench ships decides which there are.
   */
  state: string;
  detail?: string;
}

/** The app runs on Apple Silicon, whose GPU a Worker detects and trains on. */
const DEVICE = "mps";
const STATUS_POLL_MS = 2_000;
/**
 * A stop can fail without surrendering the still-running owner's identity.
 * Python owns execution cleanup and its own cooperative shutdown deadline.
 */
const STOP_GRACE_MS = 40_000;

/**
 * A Worker name for the computer called `hostname`: that name in the
 * characters a Worker name allows, and a suffix that tells two computers of
 * one name apart.
 */
export function workerNameFor(hostname: string, suffix: string): string {
  const base = hostname
    .replace(/\.local$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "computer"}-${suffix}`;
}

function isWorkerStatus(
  value: unknown,
): value is WorkerStatus & { pid: number; hostRun: string } {
  if (typeof value !== "object" || value === null) return false;
  const { state, detail, pid, hostRun } = value as Record<string, unknown>;
  return (
    typeof pid === "number" &&
    typeof hostRun === "string" &&
    typeof state === "string" &&
    (detail === undefined || typeof detail === "string")
  );
}

/**
 * The Worker process this app keeps: one `seedctl` profile under a home of
 * the app's, run in the foreground as the app's child instead of as a
 * system service. Closing standard input requests cleanup. The app retains
 * the process until it exits, including when cleanup exceeds the stop timeout.
 */
export class HostedWorker {
  readonly #seedctl: () => string;
  readonly #home: string;
  /** The process, and when its end has been told. */
  #running: { child: ChildProcess; ended: Promise<void> } | null = null;

  constructor(seedctl: () => string, home: string) {
    this.#seedctl = seedctl;
    this.#home = home;
  }

  get #env(): NodeJS.ProcessEnv {
    return { ...process.env, SEEDBUDDY_HOME: this.#home };
  }

  /**
   * Saves the profile the Worker runs from, once `seedctl` has checked the
   * token against the workbench, the runtime and the device.
   */
  async configure(
    workerName: string,
    server: string,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    await run(
      this.#seedctl(),
      [
        "worker",
        "setup",
        workerName,
        "--server",
        server,
        "--device",
        DEVICE,
        "--no-service",
        "--force",
      ],
      { env: this.#env, input: `${token}\n`, signal },
    );
  }

  /** Only the process launched for this host run may report its status. */
  async #status(
    workerName: string,
    hostRun: string,
    pid: number | undefined,
  ): Promise<WorkerStatus | null> {
    if (pid === undefined) return null;
    const file = path.join(this.#home, "profiles", workerName, "status.json");
    try {
      const status: unknown = JSON.parse(await readFile(file, "utf8"));
      if (
        !isWorkerStatus(status) ||
        status.pid !== pid ||
        status.hostRun !== hostRun
      )
        return null;
      return status.detail === undefined
        ? { state: status.state }
        : { state: status.state, detail: status.detail };
    } catch {
      return null;
    }
  }

  /**
   * Runs the profile. `onStatus` is told each status the process reports
   * while it serves, and `onExit` the status it left: the one it ended with,
   * one of work under way when it was killed, or null when it wrote none.
   */
  start(
    workerName: string,
    onStatus: (status: WorkerStatus) => void,
    onExit: (status: WorkerStatus | null) => void,
  ): void {
    if (this.#running !== null) throw new Error("A Worker is still running");
    const hostRun = randomUUID();
    const child = spawn(
      this.#seedctl(),
      ["worker", "run", workerName, "--hosted"],
      {
        env: { ...this.#env, SEEDBUDDY_HOST_RUN: hostRun },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.stdin?.on("error", () => {});
    /** Why the process could not be run or kept, when it could not. */
    let failure: Error | null = null;
    /** Whether the process has ended, after which it reports nothing more. */
    let over = false;
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", resolve);
      child.once("error", (error) => {
        failure = error;
        if (child.pid === undefined) resolve(null);
      });
    });

    let reported = "";
    const watch = setInterval(() => {
      void this.#status(workerName, hostRun, child.pid).then((status) => {
        const key = JSON.stringify(status);
        if (status === null || key === reported || over) return;
        reported = key;
        onStatus(status);
      });
    }, STATUS_POLL_MS);
    const running = {
      child,
      ended: exited.then(async (code) => {
        over = true;
        clearInterval(watch);
        // A descendant may keep stderr open after the root exits. Diagnostics
        // have a bounded tail drain; they never define process completion.
        await new Promise<void>((resolve) => {
          const stream = child.stderr;
          if (!stream || stream.destroyed) return resolve();
          const timer = setTimeout(() => {
            stream.destroy();
            resolve();
          }, 100);
          stream.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        if (code !== 0)
          failure ??= new Error(stderr.trim() || `Worker exited with ${code}`);
        const status = await this.#status(workerName, hostRun, child.pid);
        onExit(
          status && !["running", "training", "starting"].includes(status.state)
            ? status
            : failure
              ? { state: "failed", detail: failure.message }
              : status,
        );
        if (this.#running === running) this.#running = null;
      }),
    };
    this.#running = running;
  }

  /**
   * Requests cleanup and waits for exit. A timeout retains the owner: killing
   * it would release the profile lock without proving its executions ended.
   */
  async stop(): Promise<void> {
    const running = this.#running;
    if (running === null) return;
    const { child } = running;
    child.stdin?.end();
    let overdue: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        running.ended,
        new Promise<never>((_, reject) => {
          overdue = setTimeout(
            () => reject(new Error("Worker cleanup is still in progress")),
            STOP_GRACE_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(overdue);
    }
  }

  drain(): void {
    this.#running?.child.stdin?.write("drain\n");
  }
}
