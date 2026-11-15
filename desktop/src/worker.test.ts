import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { expect, test } from "bun:test";

import { HostedWorker, type WorkerStatus, workerNameFor } from "./worker";

/**
 * A stand-in for `seedctl`: `setup` keeps the token and arguments it was
 * given, and `run` serves until it is asked to finish. A profile marked
 * removed ends at once the way a refused Worker does, one marked crashing ends
 * without a word, one marked garbled leaves a status that is none, and one
 * marked stalling leaves a status that cannot be read until something is
 * written to it.
 */
const SEEDCTL = `#!/bin/sh
profile="$SEEDBUDDY_HOME/profiles/$3"
mkdir -p "$profile"
case "$2" in
  setup)
    read token
    echo "$token $*" > "$profile/setup"
    ;;
  run)
    if [ -f "$profile/removed" ]; then
      echo '{"state": "unenrolled", "detail": "removed"}' > "$profile/status.json"
      exit 0
    fi
    [ -f "$profile/crashing" ] && exit 1
    if [ -f "$profile/stalling" ]; then
      mkfifo "$profile/status.json"
      exit 1
    fi
    if [ -f "$profile/garbled" ]; then
      echo '{"state": 3}' > "$profile/status.json"
      exit 1
    fi
    trap 'echo "{\\"state\\": \\"stopped\\"}" > "$profile/status.json"; exit 0' TERM
    echo '{"state": "running"}' > "$profile/status.json"
    while :; do sleep 0.1; done
    ;;
esac
`;

async function hosted() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "seedbuddy-worker-")),
  );
  const seedctl = path.join(directory, "seedctl");
  await writeFile(seedctl, SEEDCTL);
  await chmod(seedctl, 0o755);
  const home = path.join(directory, "home");
  await mkdir(home);
  return { seedctl, home, worker: new HostedWorker(seedctl, home) };
}

/** What a Worker process reported, and whether and how it was told it ended. */
function listener() {
  const exit = Promise.withResolvers<WorkerStatus | null>();
  const serving = Promise.withResolvers<void>();
  const heard = {
    statuses: [] as WorkerStatus[],
    told: false,
    exited: exit.promise,
    serving: serving.promise,
    onStatus: (status: WorkerStatus) => {
      heard.statuses.push(status);
      serving.resolve();
    },
    onExit: (status: WorkerStatus | null) => {
      heard.told = true;
      exit.resolve(status);
    },
  };
  return heard;
}

/** Marks the profile for the stand-in to end `how` when it is run. */
async function marked(
  home: string,
  how: "removed" | "crashing" | "garbled" | "stalling",
) {
  const profile = path.join(home, "profiles", "lab-mac");
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, how), "");
  return profile;
}

function alive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

test("a Worker name is the host name in the characters a Worker name allows", () => {
  expect(workerNameFor("Lab's MacBook-Pro.local", "1a2b")).toBe(
    "lab-s-macbook-pro-1a2b",
  );
  expect(workerNameFor("实验室", "1a2b")).toBe("computer-1a2b");
});

test("configuring pipes the token to a setup that installs no service", async () => {
  const { home, worker } = await hosted();

  await worker.configure(
    "lab-mac",
    "https://seedbuddy.test",
    "token",
    new AbortController().signal,
  );

  expect(
    await readFile(path.join(home, "profiles", "lab-mac", "setup"), "utf8"),
  ).toBe(
    "token worker setup lab-mac --server https://seedbuddy.test --device mps --no-service --force\n",
  );
});

test("a started Worker reports its status until it is stopped", async () => {
  const { home, worker } = await hosted();
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  const pid = Number(await readFile(path.join(home, "hosted.pid"), "utf8"));
  await heard.serving;
  await worker.stop();

  expect(heard.statuses).toEqual([{ state: "running" }]);
  expect(await heard.exited).toEqual({ state: "stopped" });
  expect(alive(pid)).toBe(false);
  expect(await Bun.file(path.join(home, "hosted.pid")).exists()).toBe(false);
});

test("a Worker that ends on its own says how it ended", async () => {
  const { home, worker } = await hosted();
  await marked(home, "removed");
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toEqual({
    state: "unenrolled",
    detail: "removed",
  });
  await worker.stop();
});

test("a status left by an earlier process is not this one's", async () => {
  const { home, worker } = await hosted();
  const profile = await marked(home, "crashing");
  await writeFile(path.join(profile, "status.json"), '{"state": "stopped"}');
  await wait(20);
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toBeNull();
});

test("a Worker that cannot be run says why", async () => {
  const { home } = await hosted();
  const worker = new HostedWorker("/no/such/seedctl", home);
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toEqual({
    state: "failed",
    detail: expect.stringContaining("ENOENT"),
  });
  await worker.stop();
});

test("a process an earlier run of the app left behind is ended first", async () => {
  const { seedctl, home, worker } = await hosted();
  const leftover = spawn(seedctl, ["worker", "run", "lab-mac"], {
    env: { ...process.env, SEEDBUDDY_HOME: home },
    stdio: "ignore",
  });
  const gone = new Promise((resolve) => leftover.once("exit", resolve));
  await writeFile(path.join(home, "hosted.pid"), String(leftover.pid));
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  await gone;
  const pid = Number(await readFile(path.join(home, "hosted.pid"), "utf8"));

  expect(pid).not.toBe(leftover.pid);
  expect(alive(pid)).toBe(true);
  await worker.stop();
  expect(alive(pid)).toBe(false);
});

test("stopping ends a process an earlier run of the app left behind", async () => {
  const { seedctl, home, worker } = await hosted();
  const leftover = spawn(seedctl, ["worker", "run", "lab-mac"], {
    env: { ...process.env, SEEDBUDDY_HOME: home },
    stdio: "ignore",
  });
  const gone = new Promise((resolve) => leftover.once("exit", resolve));
  await writeFile(path.join(home, "hosted.pid"), String(leftover.pid));

  await worker.stop();
  await gone;

  expect(await Bun.file(path.join(home, "hosted.pid")).exists()).toBe(false);
});

test("a process that is not this app's Worker is left alone", async () => {
  const { home, worker } = await hosted();
  const unrelated = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
  await writeFile(path.join(home, "hosted.pid"), String(unrelated.pid));
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  await worker.stop();

  expect(unrelated.pid !== undefined && alive(unrelated.pid)).toBe(true);
  unrelated.kill();
});

test("a status that is none seedctl writes is not reported", async () => {
  const { home, worker } = await hosted();
  await marked(home, "garbled");
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toBeNull();
});

test("stopping during a start ends the process it starts", async () => {
  const { home, worker } = await hosted();
  const heard = listener();

  const starting = worker.start("lab-mac", heard.onStatus, heard.onExit);
  await worker.stop();
  await starting;

  expect(heard.told).toBe(true);
  expect(await Bun.file(path.join(home, "hosted.pid")).exists()).toBe(false);
});

test("stopping a process that ended on its own waits until its end is told", async () => {
  const { home, worker } = await hosted();
  const profile = await marked(home, "stalling");
  const heard = listener();
  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  const pid = Number(await readFile(path.join(home, "hosted.pid"), "utf8"));
  while (alive(pid)) await wait(5);
  // The end is being told, held up reading the status the process left.
  await wait(50);

  const stopped = worker.stop().then(() => heard.told);
  await writeFile(path.join(profile, "status.json"), '{"state": "failed"}');

  expect(await stopped).toBe(true);
  expect(await heard.exited).toEqual({ state: "failed" });
});

test("stopping with no process running resolves", async () => {
  const { worker } = await hosted();

  await worker.stop();
});
