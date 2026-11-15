import { type ChildProcess, spawn } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

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
const STOP_GRACE_MS = 30_000;

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

function isWorkerStatus(value: unknown): value is WorkerStatus {
  if (typeof value !== "object" || value === null) return false;
  const { state, detail } = value as Record<string, unknown>;
  return (
    typeof state === "string" &&
    (detail === undefined || typeof detail === "string")
  );
}

/** Whether `pid` was there to be sent the signal; 0 only asks. */
function send(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    return process.kill(pid, signal);
  } catch {
    return false;
  }
}

/** Asks a process to finish, and makes it once it has had long enough. */
async function end(pid: number): Promise<void> {
  if (!send(pid, "SIGTERM")) return;
  const deadline = Date.now() + STOP_GRACE_MS;
  while (send(pid, 0)) {
    if (Date.now() > deadline) send(pid, "SIGKILL");
    await wait(200);
  }
}

/**
 * The Worker process this app keeps: one `seedctl` profile under a home of
 * the app's, run in the foreground as the app's child instead of as a
 * system service.
 */
export class HostedWorker {
  readonly #seedctl: string;
  readonly #home: string;
  /** The process, and when its end has been told. */
  #running: { child: ChildProcess; ended: Promise<void> } | null = null;
  #starting: Promise<void> = Promise.resolve();

  constructor(seedctl: string, home: string) {
    this.#seedctl = seedctl;
    this.#home = home;
  }

  get #env(): NodeJS.ProcessEnv {
    return { ...process.env, SEEDBUDDY_HOME: this.#home };
  }

  /**
   * Names the process from the moment it is spawned, before it has recorded
   * anything itself, for a later run of the app to find it by.
   */
  get #pidFile(): string {
    return path.join(this.#home, "hosted.pid");
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
      this.#seedctl,
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

  /** The status the profile's process has written since `since`, or null. */
  async #status(
    workerName: string,
    since: number,
  ): Promise<WorkerStatus | null> {
    const file = path.join(this.#home, "profiles", workerName, "status.json");
    try {
      if ((await stat(file)).mtimeMs < since) return null;
      const status: unknown = JSON.parse(await readFile(file, "utf8"));
      return isWorkerStatus(status) ? status : null;
    } catch {
      return null;
    }
  }

  /**
   * Ends a Worker process an earlier run of the app left behind, because it
   * was killed or quit while the process was finishing: two processes of one
   * Worker would contend for it.
   */
  async #endLeftover(): Promise<void> {
    const pid = Number(await readFile(this.#pidFile, "utf8").catch(() => ""));
    if (!Number.isInteger(pid) || pid <= 0) return;
    const command = await run("ps", ["-p", String(pid), "-o", "command="], {
      env: process.env,
    }).catch(() => "");
    if (command.includes(this.#seedctl)) await end(pid);
    await rm(this.#pidFile, { force: true });
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
  ): Promise<void> {
    this.#starting = this.#start(workerName, onStatus, onExit);
    return this.#starting;
  }

  async #start(
    workerName: string,
    onStatus: (status: WorkerStatus) => void,
    onExit: (status: WorkerStatus | null) => void,
  ): Promise<void> {
    await this.#endLeftover();
    const since = Date.now();
    const child = spawn(this.#seedctl, ["worker", "run", workerName], {
      env: this.#env,
      stdio: "ignore",
    });
    /** Why the process could not be run or kept, when it could not. */
    let failure: Error | null = null;
    /** Whether the process has ended, after which it reports nothing more. */
    let over = false;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", (error) => {
        failure = error;
        resolve();
      });
    });

    let reported = "";
    const watch = setInterval(() => {
      void this.#status(workerName, since).then((status) => {
        const key = JSON.stringify(status);
        if (status === null || key === reported || over) return;
        reported = key;
        onStatus(status);
      });
    }, STATUS_POLL_MS);
    const running = {
      child,
      ended: exited.then(async () => {
        over = true;
        clearInterval(watch);
        // A file that stays names a process that is gone, which the next
        // start finds.
        await rm(this.#pidFile, { force: true }).catch(() => {});
        onExit(
          failure
            ? { state: "failed", detail: failure.message }
            : await this.#status(workerName, since),
        );
        if (this.#running === running) this.#running = null;
      }),
    };
    this.#running = running;
    if (child.pid === undefined) return;
    // A process no later run of the app could find is not left running.
    await writeFile(this.#pidFile, String(child.pid)).catch((error: Error) => {
      failure = error;
      child.kill();
    });
  }

  /**
   * Asks the process to finish, a start under way first getting as far as
   * its process, and resolves once `onExit` has been told of its end. With
   * none started here, one an earlier run of the app left behind is ended.
   */
  async stop(): Promise<void> {
    await this.#starting.catch(() => {});
    const running = this.#running;
    if (running === null) return this.#endLeftover();
    const { pid, exitCode, signalCode } = running.child;
    // One that has ended is not signalled: its pid may be another's by now.
    if (pid !== undefined && exitCode === null && signalCode === null)
      void end(pid);
    await running.ended;
  }
}
