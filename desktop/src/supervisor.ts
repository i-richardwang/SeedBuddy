import { Serial } from "./serial";
import type { Settings } from "./settings";
import type { Enrollment, WorkerPackage } from "./workbench";
import type { WorkerStatus } from "./worker";

/** What this computer is doing as a Worker, as the app shows it. */
export type Phase =
  /** Serving is turned off. */
  | { kind: "off" }
  /** Nobody is signed in to the workbench to enroll the computer for. */
  | { kind: "signed-out" }
  /** The workbench ships no Worker package. */
  | { kind: "unavailable" }
  | { kind: "installing" }
  /** Being brought up, from asking the workbench to the process reporting. */
  | { kind: "starting" }
  /** Serving, and not training. */
  | { kind: "running" }
  | { kind: "training" }
  /** The account the Worker belongs to is suspended. */
  | { kind: "suspended" }
  /** The Worker was removed in the workbench, which turned serving off. */
  | { kind: "removed" }
  | { kind: "failed"; detail: string };

/** The settings the supervisor serves by, and changes as it goes. */
export type ServingSettings = Omit<Settings, "server">;

/**
 * Everything the supervisor does to the world, so its decisions stand alone.
 * A step that takes a signal rejects once the signal has aborted.
 */
export interface Ports {
  /** The package the workbench ships, or null when it ships none. */
  describe(signal: AbortSignal): Promise<WorkerPackage | null>;
  /** The digest of the package installed on this computer, or null. */
  installed(): Promise<string | null>;
  install(shipped: WorkerPackage, signal: AbortSignal): Promise<void>;
  enroll(workerName: string, signal: AbortSignal): Promise<Enrollment>;
  /** Saves the profile the Worker runs from, holding its token. */
  configure(
    workerName: string,
    token: string,
    signal: AbortSignal,
  ): Promise<void>;
  start(
    workerName: string,
    onStatus: (status: WorkerStatus) => void,
    onExit: (status: WorkerStatus | null) => void,
  ): Promise<void>;
  /** Resolves once the Worker process, if any, has ended and `onExit` was told. */
  stop(): Promise<void>;
  /** A name for this computer, new each time. */
  newWorkerName(): string;
  save(settings: ServingSettings): Promise<void>;
  /** Runs `task` after `ms`; the function returned calls it off. */
  later(ms: number, task: () => void): () => void;
}

const RETRY_MS = 30_000;
const SLOW_RETRY_MS = 5 * 60_000;

/**
 * Keeps this computer serving as the signed-in account's personal Worker:
 * installs the package the workbench ships, enrolls the computer, runs the
 * Worker process, and answers each way that process can end.
 */
export class Supervisor {
  readonly #ports: Ports;
  readonly #onPhase: (phase: Phase) => void;
  #settings: ServingSettings;
  #phase: Phase;
  #alive = false;
  /** The process is being stopped from here, so its end is no news. */
  #stopping = false;
  #closed = false;
  /** Passes and update checks, one at a time. */
  readonly #passes = new Serial();
  /** Drops the pass or check under way. */
  #abort = new AbortController();
  #cancelRetry: (() => void) | null = null;

  constructor(
    ports: Ports,
    settings: ServingSettings,
    onPhase: (phase: Phase) => void,
  ) {
    this.#ports = ports;
    this.#settings = settings;
    this.#onPhase = onPhase;
    this.#phase = { kind: settings.serving ? "starting" : "off" };
  }

  get phase(): Phase {
    return this.#phase;
  }

  /** Brings the Worker to what the settings ask for. */
  reconcile(): Promise<void> {
    return this.#passes.run(() => this.#reconcile());
  }

  /** A pass under way answers what was asked before, so it is dropped. */
  async setServing(serving: boolean): Promise<void> {
    if (this.#closed) return;
    this.#abort.abort();
    await Promise.all([this.#save({ serving }), this.reconcile()]);
  }

  /** The window went somewhere: someone may have signed in to enroll for. */
  navigated(): void {
    if (this.#phase.kind === "signed-out") void this.reconcile();
  }

  /**
   * Installs what the workbench ships now when it differs from what is
   * installed, unless the Worker is training.
   */
  update(): Promise<void> {
    return this.#passes.run(() => this.#update());
  }

  /**
   * Ends the Worker process and whatever pass is under way, as the app quits
   * or changes workbench. Nothing is done or shown after it resolves.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelRetry?.();
    this.#abort.abort();
    await this.#stop();
    await this.#passes.run(async () => {});
  }

  /** The signal the pass or check now beginning is dropped by. */
  #begin(): AbortSignal {
    this.#abort = new AbortController();
    return this.#abort.signal;
  }

  async #save(change: Partial<ServingSettings>): Promise<void> {
    this.#settings = { ...this.#settings, ...change };
    await this.#ports.save(this.#settings);
  }

  /** A closed supervisor has nothing more to show. */
  #show(phase: Phase): void {
    if (this.#closed) return;
    this.#phase = phase;
    this.#onPhase(phase);
  }

  #retry(ms: number): void {
    this.#cancelRetry?.();
    this.#cancelRetry = this.#ports.later(ms, () => void this.reconcile());
  }

  async #stop(): Promise<void> {
    this.#stopping = true;
    try {
      await this.#ports.stop();
    } finally {
      this.#stopping = false;
    }
  }

  async #reconcile(): Promise<void> {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    if (this.#closed) return;
    const signal = this.#begin();
    try {
      if (!this.#settings.serving) {
        await this.#stop();
        // Serving turned on again while the process ended is shown by the
        // pass behind this one.
        signal.throwIfAborted();
        this.#show({ kind: "off" });
        return;
      }
      if (this.#alive) return;
      this.#show({ kind: "starting" });
      const shipped = await this.#ports.describe(signal);
      if (shipped === null) {
        this.#show({ kind: "unavailable" });
        this.#retry(SLOW_RETRY_MS);
        return;
      }
      if ((await this.#ports.installed()) !== shipped.digest) {
        this.#show({ kind: "installing" });
        await this.#ports.install(shipped, signal);
        this.#show({ kind: "starting" });
      }
      if (!this.#settings.enrolled && !(await this.#enroll(signal))) return;
      // No signal drops reading what is installed or saving the settings,
      // and a process is not started for what was asked before.
      signal.throwIfAborted();
      this.#alive = true;
      await this.#ports.start(
        this.#settings.workerName,
        (status) => this.#observed(status),
        (status) => void this.#exited(status),
      );
    } catch (error) {
      this.#alive = false;
      // Dropped for what was asked since, which the pass behind this one
      // answers.
      if (signal.aborted) return;
      this.#show({
        kind: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      this.#retry(RETRY_MS);
    }
  }

  /** Whether the computer is enrolled; false leaves it waiting for a sign-in. */
  async #enroll(signal: AbortSignal): Promise<boolean> {
    let enrollment = await this.#ports.enroll(
      this.#settings.workerName,
      signal,
    );
    if (enrollment.kind === "taken") {
      await this.#save({ workerName: this.#ports.newWorkerName() });
      enrollment = await this.#ports.enroll(this.#settings.workerName, signal);
    }
    if (enrollment.kind === "signed-out") {
      this.#show({ kind: "signed-out" });
      return false;
    }
    if (enrollment.kind === "taken")
      throw new Error(
        `Another Worker is already named ${this.#settings.workerName}`,
      );
    await this.#ports.configure(
      this.#settings.workerName,
      enrollment.token,
      signal,
    );
    await this.#save({ enrolled: true });
    return true;
  }

  async #update(): Promise<void> {
    /** By what the process last reported. */
    const idle = () => this.#alive && this.#phase.kind === "running";
    if (this.#closed || !idle()) return;
    const shipped = await this.#ports.describe(this.#begin()).catch(() => null);
    if (shipped === null || shipped.digest === (await this.#ports.installed()))
      return;
    // Asked again last of all: a run may have begun while the workbench
    // answered.
    if (!idle()) return;
    await this.#stop();
    await this.#reconcile();
  }

  #observed({ state }: WorkerStatus): void {
    if (state === "running" || state === "training")
      this.#show({ kind: state });
  }

  async #exited(status: WorkerStatus | null): Promise<void> {
    this.#alive = false;
    // Whoever stopped the process goes on from its end.
    if (this.#stopping || this.#closed) return;
    switch (status?.state) {
      // Someone removed this Worker in the workbench: it stays out until
      // serving is turned on again here.
      case "unenrolled":
        await this.#save({ enrolled: false, serving: false });
        this.#show({ kind: "removed" });
        return;
      case "suspended":
        this.#show({ kind: "suspended" });
        this.#retry(SLOW_RETRY_MS);
        return;
      // A workbench of another protocol revision ships another package,
      // which the next pass installs; anything else is tried again as it is.
      default:
        this.#show({
          kind: "failed",
          detail: status?.detail ?? "The Worker process ended unexpectedly",
        });
        this.#retry(RETRY_MS);
    }
  }
}
