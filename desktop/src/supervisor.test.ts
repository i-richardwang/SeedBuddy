import { expect, test } from "bun:test";

import {
  type Phase,
  type Ports,
  type ServingSettings,
  Supervisor,
} from "./supervisor";
import type { Enrollment, WorkerPackage } from "./workbench";
import type { WorkerStatus } from "./worker";

const SHIPPED: WorkerPackage = {
  id: "new",
  filename: "seedctl.whl",
  digest: "wheel",
  hostProtocol: 1,
  python: "3.13.14",
  requirements: "pillow==12.3.0\n",
};

/** `step`, unless the signal drops it first. */
function unlessDropped<T>(step: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return Promise.race([
    step,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    }),
  ]);
}

/** A computer and a workbench the supervisor acts on, and what it did to them. */
class World implements Ports {
  shipped: WorkerPackage | null = SHIPPED;
  installedId: string | null = null;
  enrollments: Enrollment[] = [];
  failure: Error | null = null;
  /** What an install waits for before it is done, unless it is dropped. */
  installing: Promise<void> = Promise.resolve();
  /** What reading the installed package, a step no signal drops, waits for. */
  reading: Promise<void> = Promise.resolve();
  /** What the settings being written waits for. */
  writing: Promise<void> = Promise.resolve();
  /** What a process asked to stop waits for, and the state it then leaves. */
  ending: Promise<void> = Promise.resolve();
  leaves = "stopped";
  settings: ServingSettings;
  did: string[] = [];
  phases: string[] = [];
  retries: { ms: number; task: () => void }[] = [];
  running: {
    onStatus: (status: WorkerStatus) => void;
    onExit: (status: WorkerStatus | null) => void;
  } | null = null;
  readonly supervisor: Supervisor;

  constructor(saved: Partial<ServingSettings> = {}) {
    this.settings = {
      serving: true,
      enrolled: false,
      workerName: "lab-mac",
      ...saved,
    };
    this.supervisor = new Supervisor(this, this.settings, (phase: Phase) =>
      this.phases.push(phase.kind === "failed" ? phase.detail : phase.kind),
    );
  }

  async describe(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    return this.shipped;
  }

  async installed() {
    await this.reading;
    return this.installedId;
  }

  async install(shipped: WorkerPackage, signal: AbortSignal) {
    this.did.push(`install ${shipped.id}`);
    await unlessDropped(this.installing, signal);
    this.installedId = shipped.id;
  }

  async enroll(workerName: string, signal: AbortSignal) {
    signal.throwIfAborted();
    this.did.push(`enroll ${workerName}`);
    return this.enrollments.shift() ?? { kind: "enrolled", token: "token" };
  }

  async configure(workerName: string, token: string, signal: AbortSignal) {
    signal.throwIfAborted();
    this.did.push(`configure ${workerName} ${token}`);
  }

  start(
    workerName: string,
    onStatus: (status: WorkerStatus) => void,
    onExit: (status: WorkerStatus | null) => void,
  ) {
    this.did.push(`start ${workerName}`);
    this.running = { onStatus, onExit };
  }

  /** The Worker process ends, having reported `state`. */
  async exit(state: string | null, detail?: string) {
    const running = this.running;
    this.running = null;
    running?.onExit(state === null ? null : { state, detail });
    await this.settled();
  }

  async stop() {
    this.did.push("stop");
    await this.ending;
    if (this.running) await this.exit(this.leaves);
  }

  drain() {
    this.did.push("drain");
  }

  newWorkerName() {
    return "lab-mac-2";
  }

  async save(settings: ServingSettings) {
    this.settings = settings;
    await this.writing;
  }

  later(ms: number, task: () => void) {
    const retry = { ms, task };
    this.retries.push(retry);
    return () => {
      this.retries = this.retries.filter((other) => other !== retry);
    };
  }

  /** Lets what was set off without being awaited run to its end. */
  async settled() {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  }
}

/** A computer set up from the package a workbench shipped before this one. */
function setUpFromAnOlderPackage(): World {
  const world = new World({ enrolled: true });
  world.shipped = { ...SHIPPED, id: "old", requirements: "pillow==12.2.0\n" };
  world.installedId = "old";
  return world;
}

/** A computer set up from the package the workbench ships. */
function setUp(): World {
  const world = new World({ enrolled: true });
  world.installedId = SHIPPED.id;
  return world;
}

test("a computer new to a workbench installs, enrolls and serves", async () => {
  const world = new World();

  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "running" });

  expect(world.did).toEqual([
    "install new",
    "enroll lab-mac",
    "configure lab-mac token",
    "start lab-mac",
  ]);
  expect(world.phases).toEqual([
    "starting",
    "installing",
    "starting",
    "running",
  ]);
  expect(world.settings.enrolled).toBe(true);
});

test("a computer already set up only starts", async () => {
  const world = setUp();

  await world.supervisor.reconcile();
  await world.supervisor.reconcile();

  expect(world.did).toEqual(["start lab-mac"]);
});

test("with nobody signed in, it waits for a sign-in", async () => {
  const world = new World();
  world.enrollments = [{ kind: "signed-out" }];

  await world.supervisor.reconcile();
  expect(world.supervisor.phase).toEqual({ kind: "signed-out" });
  expect(world.running).toBeNull();
  expect(world.retries).toEqual([]);

  world.supervisor.navigated();
  await world.settled();

  expect(world.supervisor.phase).toEqual({ kind: "starting" });
});

test("a name another Worker holds is given up for another", async () => {
  const world = new World();
  world.enrollments = [{ kind: "taken" }];

  await world.supervisor.reconcile();

  expect(world.did).toContain("configure lab-mac-2 token");
  expect(world.settings.workerName).toBe("lab-mac-2");
});

test("a second name taken as well is a failure, tried again", async () => {
  const world = new World();
  world.enrollments = [{ kind: "taken" }, { kind: "taken" }];

  await world.supervisor.reconcile();

  expect(world.supervisor.phase).toEqual({
    kind: "failed",
    detail: "Another Worker is already named lab-mac-2",
  });
  expect(world.running).toBeNull();
  expect(world.retries).toHaveLength(1);
});

test("a workbench that ships no package is asked again later", async () => {
  const world = new World();
  world.shipped = null;

  await world.supervisor.reconcile();

  expect(world.supervisor.phase).toEqual({ kind: "unavailable" });
  expect(world.did).toEqual([]);
  expect(world.retries).toHaveLength(1);
});

test("a step that fails is shown and tried again", async () => {
  const world = new World();
  world.failure = new Error("The workbench is unreachable");

  await world.supervisor.reconcile();
  expect(world.phases).toEqual(["starting", "The workbench is unreachable"]);

  world.failure = null;
  world.retries[0]?.task();
  await world.settled();

  expect(world.supervisor.phase).toEqual({ kind: "starting" });
  expect(world.retries).toEqual([]);
});

test("turning serving off stops the Worker, and on starts it again", async () => {
  const world = new World();
  await world.supervisor.reconcile();

  await world.supervisor.setServing(false);
  expect(world.running).toBeNull();
  expect(world.supervisor.phase).toEqual({ kind: "off" });
  expect(world.settings.serving).toBe(false);

  await world.supervisor.setServing(true);
  expect(world.running).not.toBeNull();
});

test("turning serving off drops an install under way", async () => {
  const world = new World();
  world.installing = new Promise(() => {});
  const pass = world.supervisor.reconcile();
  await world.settled();

  await world.supervisor.setServing(false);
  await pass;

  expect(world.did).toEqual(["install new", "stop"]);
  expect(world.supervisor.phase).toEqual({ kind: "off" });
  expect(world.retries).toEqual([]);
});

test("turning serving off during a step no signal drops starts no Worker", async () => {
  const world = setUp();
  const read = Promise.withResolvers<void>();
  world.reading = read.promise;
  void world.supervisor.reconcile();
  await world.settled();

  const written = Promise.withResolvers<void>();
  world.writing = written.promise;
  const off = world.supervisor.setServing(false);
  await world.settled();
  read.resolve();
  await world.settled();
  expect(world.did).toEqual(["stop"]);

  written.resolve();
  await off;
  expect(world.did).toEqual(["stop"]);
  expect(world.phases).toEqual(["starting", "off"]);
});

test("serving turned on again while the process ends is not shown as off", async () => {
  const world = setUp();
  await world.supervisor.reconcile();
  const ended = Promise.withResolvers<void>();
  world.ending = ended.promise;
  world.did = [];
  world.phases = [];

  const off = world.supervisor.setServing(false);
  await world.settled();
  const on = world.supervisor.setServing(true);
  await world.settled();
  ended.resolve();
  await Promise.all([off, on]);

  expect(world.did).toEqual(["stop", "start lab-mac"]);
  expect(world.phases).toEqual(["starting"]);
});

test("a failed process exit during a requested stop does not restart serving", async () => {
  const world = setUp();
  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "training" });
  world.leaves = "training";

  await world.supervisor.setServing(false);

  expect(world.supervisor.phase).toEqual({ kind: "off" });
  expect(world.retries).toEqual([]);
});

test("a Worker removed in the workbench stays out until serving is turned on again", async () => {
  const world = new World();
  await world.supervisor.reconcile();
  world.did = [];

  await world.exit("unenrolled");
  expect(world.supervisor.phase).toEqual({ kind: "removed" });
  expect(world.settings).toMatchObject({ serving: false, enrolled: false });
  expect(world.did).toEqual([]);
  expect(world.retries).toEqual([]);

  await world.supervisor.setServing(true);
  expect(world.did).toEqual([
    "enroll lab-mac",
    "configure lab-mac token",
    "start lab-mac",
  ]);
});

test("a suspended account's Worker waits before it tries again", async () => {
  const world = new World();
  await world.supervisor.reconcile();

  await world.exit("suspended");

  expect(world.supervisor.phase).toEqual({ kind: "suspended" });
  expect(world.running).toBeNull();
  expect(world.retries).toHaveLength(1);
});

test("a Worker that ends on its own is shown as failed and started again", async () => {
  const world = new World();
  await world.supervisor.reconcile();

  await world.exit("failed", "The model could not be loaded");
  expect(world.supervisor.phase).toEqual({
    kind: "failed",
    detail: "The model could not be loaded",
  });
  expect(world.running).toBeNull();

  world.retries[0]?.task();
  await world.settled();
  expect(world.running).not.toBeNull();
});

test("a Worker that ends without saying how is tried again too", async () => {
  const world = new World();
  await world.supervisor.reconcile();

  await world.exit(null);

  expect(world.supervisor.phase).toEqual({
    kind: "failed",
    detail: "The Worker process ended unexpectedly",
  });
  expect(world.retries).toHaveLength(1);
});

test("a Worker of another protocol revision is replaced by the package shipped now", async () => {
  const world = setUpFromAnOlderPackage();
  await world.supervisor.reconcile();
  world.shipped = SHIPPED;
  world.did = [];

  await world.exit("incompatible", "Install the package the workbench ships");
  world.retries[0]?.task();
  await world.settled();

  expect(world.did).toEqual(["install new", "start lab-mac"]);
});

test("dependency-only updates wait for the Worker to finish, regardless of stale displayed status", async () => {
  const world = setUpFromAnOlderPackage();
  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "running" });
  world.shipped = SHIPPED;
  world.did = [];

  await world.supervisor.update();

  expect(world.did).toEqual(["drain"]);
  expect(world.installedId).toBe("old");
  // The real process can already be training before its next status poll.
  await world.exit("stopped");
  expect(world.did).toEqual(["drain", "install new", "start lab-mac"]);
});

test("a workbench that does not answer the check leaves the Worker serving", async () => {
  const world = setUpFromAnOlderPackage();
  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "running" });
  world.failure = new Error("The workbench is unreachable");
  world.did = [];

  await world.supervisor.update();

  expect(world.did).toEqual([]);
  expect(world.supervisor.phase).toEqual({ kind: "running" });
});

test("a training run is never interrupted to install a new package", async () => {
  const world = setUpFromAnOlderPackage();
  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "training" });
  world.shipped = SHIPPED;
  world.did = [];

  await world.supervisor.update();

  expect(world.did).toEqual(["drain"]);
  expect(world.supervisor.phase).toEqual({ kind: "training" });
  await world.supervisor.setServing(false);
  expect(world.running).toBeNull();
  expect(world.installedId).toBe("old");
});

test("a run that begins while the workbench is asked is not interrupted", async () => {
  const world = setUpFromAnOlderPackage();
  await world.supervisor.reconcile();
  world.running?.onStatus({ state: "running" });
  world.shipped = SHIPPED;
  world.did = [];
  const describe = world.describe.bind(world);
  world.describe = async (signal) => {
    world.running?.onStatus({ state: "training" });
    return describe(signal);
  };

  await world.supervisor.update();

  expect(world.did).toEqual(["drain"]);
});

test("login navigation while an earlier enrollment is pending is reconciled", async () => {
  const world = new World();
  const first = Promise.withResolvers<Enrollment>();
  const original = world.enroll.bind(world);
  let asked = 0;
  world.enroll = (name, signal) =>
    ++asked === 1 ? first.promise : original(name, signal);
  const starting = world.supervisor.reconcile();
  await world.settled();
  world.supervisor.navigated();
  first.resolve({ kind: "signed-out" });
  await starting;
  await world.settled();
  expect(world.settings.enrolled).toBe(true);
  expect(world.running).not.toBeNull();
});

test("closing stops the Worker and leaves it stopped", async () => {
  const world = new World();
  await world.supervisor.reconcile();

  await world.supervisor.close();
  await world.supervisor.reconcile();

  expect(world.running).toBeNull();
  expect(world.retries).toEqual([]);
});

test("a closed supervisor changes no setting", async () => {
  const world = setUp();
  await world.supervisor.reconcile();
  await world.supervisor.close();

  await world.supervisor.setServing(false);

  expect(world.settings.serving).toBe(true);
  expect(world.did).toEqual(["start lab-mac", "stop"]);
});

test("closing drops an install under way and does nothing after", async () => {
  const world = new World();
  world.installing = new Promise(() => {});
  const pass = world.supervisor.reconcile();
  await world.settled();

  await world.supervisor.close();
  await pass;

  expect(world.did).toEqual(["install new", "stop"]);
  expect(world.settings.enrolled).toBe(false);
  expect(world.running).toBeNull();
  expect(world.retries).toEqual([]);
  expect(world.phases).toEqual(["starting", "installing"]);
});

test("closing during a step no signal drops starts no Worker", async () => {
  const world = setUp();
  const read = Promise.withResolvers<void>();
  world.reading = read.promise;
  void world.supervisor.reconcile();
  await world.settled();

  const closing = world.supervisor.close();
  await world.settled();
  read.resolve();
  await closing;

  expect(world.did).toEqual(["stop"]);
  expect(world.phases).toEqual(["starting"]);
});

test("a later stop supersedes display decisions, not credential revocation", async () => {
  for (const terminal of ["failed", "unenrolled"]) {
    const world = setUp();
    await world.supervisor.reconcile();
    const read = Promise.withResolvers<void>();
    world.reading = read.promise;
    const update = world.supervisor.update();
    await world.settled();
    const stopped = world.supervisor.setServing(false);
    await world.exit(terminal, "old process ended");
    read.resolve();
    await Promise.all([update, stopped]);
    await world.settled();
    expect(world.supervisor.phase).toEqual({ kind: "off" });
    expect(world.settings).toMatchObject({
      serving: false,
      enrolled: terminal !== "unenrolled",
    });
    expect(world.retries).toEqual([]);
    await world.supervisor.setServing(true);
    expect(world.settings).toMatchObject({ serving: true, enrolled: true });
    expect(world.did.filter((action) => action.startsWith("enroll "))).toEqual(
      terminal === "unenrolled" ? ["enroll lab-mac"] : [],
    );
  }
});

test("a retired process cannot revoke replacement credentials", async () => {
  const world = setUp();
  await world.supervisor.reconcile();
  const retired = world.running;
  if (retired === null) throw new Error("Worker did not start");
  await world.exit("unenrolled");
  await world.supervisor.setServing(true);
  retired.onExit({ state: "unenrolled" });
  await world.settled();
  expect(world.settings).toMatchObject({ serving: true, enrolled: true });
  expect(world.running).not.toBeNull();
});

test("a failed stop keeps ownership and prevents a replacement until cleanup succeeds", async () => {
  const world = setUp();
  await world.supervisor.reconcile();
  const stop = world.stop.bind(world);
  world.stop = async () => {
    throw new Error("cleanup pending");
  };
  await world.supervisor.setServing(false);
  await world.supervisor.setServing(true);
  expect(world.did).toEqual(["start lab-mac"]);
  expect(world.supervisor.phase).toEqual({
    kind: "failed",
    detail: "cleanup pending",
  });
  world.stop = stop;
  await world.supervisor.reconcile();
  expect(world.did).toEqual(["start lab-mac", "stop", "start lab-mac"]);
});
