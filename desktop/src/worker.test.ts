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
 * given, and `run` names its process and serves until its standard input is
 * closed. A profile marked removed ends at once the way a refused Worker
 * does, one marked crashing ends without a word, one marked garbled leaves a
 * status that is none, and one marked stalling leaves a status that cannot be
 * read until something is written to it.
 */
const SEEDCTL = `#!/bin/sh
profile="$SEEDBUDDY_HOME/profiles/$3"
mkdir -p "$profile"
status() {
  printf '{"state":"%s","pid":%s,"hostRun":"%s"}\\n' "$1" "$$" "$SEEDBUDDY_HOST_RUN" > "$profile/status.json"
}
case "$2" in
  setup)
    read token
    echo "$token $*" > "$profile/setup"
    ;;
  run)
    echo "$* $$" > "$profile/run"
    if [ -f "$profile/removed" ]; then
      printf '{"state":"unenrolled","detail":"removed","pid":%s,"hostRun":"%s"}\\n' "$$" "$SEEDBUDDY_HOST_RUN" > "$profile/status.json"
      exit 0
    fi
    [ -f "$profile/crashing" ] && exit 1
    if [ -f "$profile/foreign" ]; then
      SEEDBUDDY_HOST_RUN=previous-run
      status unenrolled
      exit 1
    fi
    if [ -f "$profile/descendant" ]; then
      sleep 30 >&2 &
      echo $! > "$profile/descendant-pid"
      exit 1
    fi
    if [ -f "$profile/stalling" ]; then
      mkfifo "$profile/status.json"
      exit 1
    fi
    if [ -f "$profile/garbled" ]; then
      echo '{"state": 3}' > "$profile/status.json"
      exit 1
    fi
    status running
    while read command; do
      if [ "$command" = drain ]; then
        touch "$profile/draining"
        [ -f "$profile/busy" ] || break
      else
        break
      fi
    done
    status stopped
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
  return { seedctl, home, worker: new HostedWorker(() => seedctl, home) };
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
  how:
    | "removed"
    | "crashing"
    | "garbled"
    | "stalling"
    | "foreign"
    | "descendant"
    | "busy",
) {
  const profile = path.join(home, "profiles", "lab-mac");
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, how), "");
  return profile;
}

/** How the stand-in was run for the profile, and as which process. */
async function ran(home: string): Promise<{ command: string; pid: number }> {
  const file = path.join(home, "profiles", "lab-mac", "run");
  while (!(await Bun.file(file).exists())) await wait(5);
  const words = (await readFile(file, "utf8")).trim().split(" ");
  return { command: words.slice(0, -1).join(" "), pid: Number(words.at(-1)) };
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

test("a started Worker is hosted and reports its status until it is stopped", async () => {
  const { home, worker } = await hosted();
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  await heard.serving;
  const { command, pid } = await ran(home);
  await worker.stop();

  expect(command).toBe("worker run lab-mac --hosted");
  expect(heard.statuses).toEqual([{ state: "running" }]);
  expect(await heard.exited).toEqual({ state: "stopped" });
  expect(alive(pid)).toBe(false);
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

  expect(await heard.exited).toMatchObject({
    state: "failed",
    detail: "Worker exited with 1",
  });
});

test("a Worker that cannot be run says why", async () => {
  const { home } = await hosted();
  const worker = new HostedWorker(() => "/no/such/seedctl", home);
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toEqual({
    state: "failed",
    detail: expect.stringContaining("ENOENT"),
  });
  await worker.stop();
});

test("a status that is none seedctl writes is not reported", async () => {
  const { home, worker } = await hosted();
  await marked(home, "garbled");
  const heard = listener();

  await worker.start("lab-mac", heard.onStatus, heard.onExit);

  expect(await heard.exited).toMatchObject({
    state: "failed",
    detail: "Worker exited with 1",
  });
});

test("stopping immediately after launch waits for the child to exit", async () => {
  const { home, worker } = await hosted();
  const heard = listener();

  worker.start("lab-mac", heard.onStatus, heard.onExit);
  await worker.stop();

  expect(heard.told).toBe(true);
  expect(alive((await ran(home)).pid)).toBe(false);
});

test("stopping a process that ended on its own waits until its end is told", async () => {
  const { home, worker } = await hosted();
  const profile = await marked(home, "stalling");
  const heard = listener();
  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  const { pid } = await ran(home);
  while (alive(pid)) await wait(5);
  // The end is being told, held up reading the status the process left.
  await wait(50);

  const stopped = worker.stop().then(() => heard.told);
  await writeFile(path.join(profile, "status.json"), '{"state": "failed"}');

  expect(await stopped).toBe(true);
  expect(await heard.exited).toEqual({
    state: "failed",
    detail: "Worker exited with 1",
  });
});

test("stopping with no process running resolves", async () => {
  const { worker } = await hosted();

  await worker.stop();
});

test("a terminal status written during this run still needs this run's identity", async () => {
  const { home, worker } = await hosted();
  await marked(home, "foreign");
  const heard = listener();
  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  expect(await heard.exited).toEqual({
    state: "failed",
    detail: "Worker exited with 1",
  });
});

test("an exited root is reported even when a descendant retains stderr", async () => {
  const { home, worker } = await hosted();
  const profile = await marked(home, "descendant");
  const heard = listener();
  await worker.start("lab-mac", heard.onStatus, heard.onExit);
  const file = path.join(profile, "descendant-pid");
  while (!(await Bun.file(file).exists())) await wait(5);
  const pid = Number(await readFile(file, "utf8"));
  try {
    expect(
      await Promise.race([heard.exited, wait(1000).then(() => "timed out")]),
    ).toEqual({ state: "failed", detail: "Worker exited with 1" });
    await worker.stop();
    expect(alive(pid)).toBe(true);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});

test.each([false, true])(
  "drain finishes idle work; EOF can interrupt an admitted task: busy=%s",
  async (busy) => {
    const { home, worker } = await hosted();
    if (busy) await marked(home, "busy");
    const heard = listener();
    await worker.start("lab-mac", heard.onStatus, heard.onExit);
    await ran(home);
    worker.drain();
    while (
      !(await Bun.file(path.join(home, "profiles/lab-mac/draining")).exists())
    )
      await wait(5);
    if (busy) {
      expect(heard.told).toBe(false);
      await worker.stop();
    }
    expect(await heard.exited).toEqual({ state: "stopped" });
  },
);
