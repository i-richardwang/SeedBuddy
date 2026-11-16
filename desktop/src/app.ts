import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerSaveBlocker,
  session,
  shell,
  Tray,
} from "electron";

import { messages } from "./messages";
import { destination, opensInBrowser } from "./navigation";
import { finishBeforeQuit } from "./quit";
import { newerRelease, type Release } from "./release";
import { Runtime } from "./runtime";
import { Serial } from "./serial";
import { readSettings, type Settings, writeSettings } from "./settings";
import { type Phase, Supervisor } from "./supervisor";
import {
  answers,
  describePackage,
  downloadPackage,
  enroll,
  type Fetch,
  parseServer,
} from "./workbench";
import { HostedWorker, workerNameFor } from "./worker";

const UPDATE_CHECK_MS = 15 * 60_000;
const RELEASE_CHECK_MS = 24 * 60 * 60_000;
/** A load another navigation took the place of, which is no failure. */
const ERR_ABORTED = -3;
/** What a page may ask of the computer: the workbench copies text, no more. */
const PERMITTED = new Set(["clipboard-sanitized-write"]);

/** The page that asks which workbench to open, built beside this module. */
const connectPage = path.join(import.meta.dirname, "connect.html");
const data = app.getPath("userData");
const settingsFile = path.join(data, "settings.json");
/** What last went wrong, in full. */
const failureFile = path.join(data, "failure.log");
const uv = app.isPackaged
  ? path.join(process.resourcesPath, "uv")
  : path.join(app.getAppPath(), "resources", "uv");
const text = messages(app.getLocale());
const sessionFetch: Fetch = (url, init) =>
  session.defaultSession.fetch(url, init);

const newWorkerName = () =>
  workerNameFor(hostname(), randomBytes(2).toString("hex"));

let settings = await readSettings(settingsFile, () => ({
  server: null,
  workerName: newWorkerName(),
  enrolled: false,
  serving: true,
}));
let supervisor: Supervisor | null = null;
let window: BrowserWindow | null = null;
let awake: number | null = null;
/** What the menu bar item says the computer is doing. */
let status = text.noWorkbench;
/** A later version of the app than this one, once one is known of. */
let release: Release | null = null;
/** Writes of the settings file, one at a time. */
const writes = new Serial();
/** Changes of workbench, one at a time. */
const connections = new Serial();
let acceptingConnections = true;

/** Keeps `detail` as what last went wrong; there is nowhere to say it cannot. */
function record(detail: string): void {
  writeFile(failureFile, `${new Date().toISOString()}\n${detail}\n`).catch(
    () => {},
  );
}

/**
 * Changes the settings at once, and resolves once the file holds them. A file
 * that cannot be written leaves them changed until the app quits, and says why.
 */
function save(change: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...change };
  const changed = settings;
  return writes
    .run(() => writeSettings(settingsFile, changed))
    .catch((error: Error) =>
      record(`The settings could not be saved: ${error.message}`),
    );
}

const tray = new Tray(
  nativeImage.createFromPath(
    path.join(import.meta.dirname, "trayTemplate.png"),
  ),
);

/** The menu bar item says what the computer is doing and holds the app's controls. */
function showMenu(): void {
  const offered = release;
  tray.setToolTip(status);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: "separator" },
      {
        label: text.serve,
        type: "checkbox",
        checked: settings.serving,
        enabled: supervisor !== null,
        click: ({ checked }) => void supervisor?.setServing(checked),
      },
      { type: "separator" },
      { label: text.open, click: showWindow },
      {
        label: text.changeWorkbench,
        enabled: settings.server !== null,
        click: () => void changeWorkbench(),
      },
      { type: "separator" },
      ...(offered === null
        ? []
        : [
            {
              label: text.download(offered.version),
              click: () => void shell.openExternal(offered.page),
            },
          ]),
      { label: text.quit, role: "quit" },
    ]),
  );
}

/**
 * Offers a later version of the app in the menu once one is published. One
 * already offered stays while the releases cannot be read.
 */
async function offerRelease(): Promise<void> {
  const newer = await newerRelease(sessionFetch, app.getVersion());
  if (newer === null) return;
  release = newer;
  showMenu();
}

/** A training run keeps the computer from idle sleep until it ends. */
function keepAwake(training: boolean): void {
  if (training && awake === null)
    awake = powerSaveBlocker.start("prevent-app-suspension");
  if (!training && awake !== null) {
    powerSaveBlocker.stop(awake);
    awake = null;
  }
}

/** Says `next` in the menu bar item. */
function say(next: string): void {
  status = next;
  showMenu();
}

function shown(phase: Phase): void {
  keepAwake(phase.kind === "training");
  say(text.phase(phase));
  if (phase.kind === "failed") record(phase.detail);
}

/** Starts serving the workbench the settings name, when they name one. */
function serve(): void {
  const { server, ...serving } = settings;
  if (server === null) {
    say(text.noWorkbench);
    return;
  }
  const runtime = new Runtime(path.join(data, "runtime"), uv);
  const worker = new HostedWorker(
    () => runtime.seedctl,
    path.join(data, "worker"),
  );
  supervisor = new Supervisor(
    {
      describe: (signal) => describePackage(sessionFetch, server, signal),
      installed: () => runtime.installed(),
      install: async (shipped, signal) =>
        runtime.install(
          shipped,
          await downloadPackage(sessionFetch, server, shipped, signal),
          signal,
        ),
      enroll: (name, signal) => enroll(sessionFetch, server, name, signal),
      configure: (name, token, signal) =>
        worker.configure(name, server, token, signal),
      start: (name, onStatus, onExit) => worker.start(name, onStatus, onExit),
      stop: () => worker.stop(),
      drain: () => worker.drain(),
      newWorkerName,
      save,
      later: (ms, task) => {
        const timer = setTimeout(task, ms);
        return () => clearTimeout(timer);
      },
    },
    serving,
    shown,
  );
  shown(supervisor.phase);
  void supervisor.reconcile();
}

/**
 * Connects the app to the workbench at `server`, or, with null, to none.
 * This computer serves the workbench the app is connected to and no other:
 * leaving one ends its Worker process and gives up the enrollment there.
 */
function connect(server: string | null): Promise<void> {
  return connections.run(async () => {
    if (!acceptingConnections || server === settings.server) return;
    // The menu's controls go with the workbench being left.
    const leaving = supervisor;
    await leaving?.close();
    supervisor = null;
    keepAwake(false);
    say(text.noWorkbench);
    await save({ server, enrolled: false });
    serve();
  });
}

/** The address typed into the connect page opens once a workbench answers there. */
async function tryAddress(typed: string): Promise<void> {
  const server = parseServer(typed);
  if (server !== null && (await answers(sessionFetch, server))) {
    await connect(server);
    await showWorkbench();
  } else await askForWorkbench(typed);
}

/** Leaves the workbench for another, once the page shown lets the window go. */
async function changeWorkbench(): Promise<void> {
  if (await askForWorkbench()) await connect(null);
}

/**
 * Shows the page that asks which workbench to open, saying so when the one
 * `tried` did not answer. False when the window shows something else after
 * all: a page with unsaved work kept it, or another load took its place.
 */
function askForWorkbench(tried?: string): Promise<boolean> {
  return frontWindow()
    .loadFile(connectPage, {
      query: {
        lang: text.lang,
        heading: text.connectHeading,
        hint: text.connectHint,
        connect: text.connect,
        ...(tried && { server: tried, refused: text.refused(tried) }),
      },
    })
    .then(
      () => true,
      () => false,
    );
}

/** Shows the workbench the app is connected to, or asks for one. */
async function showWorkbench(): Promise<void> {
  if (settings.server === null) await askForWorkbench();
  // A load that fails tells `did-fail-load`, which answers it.
  else
    await frontWindow()
      .loadURL(settings.server)
      .catch(() => {});
}

/** The app's window in front, opened when it was closed. */
function frontWindow(): BrowserWindow {
  if (window !== null) {
    window.show();
    window.focus();
    return window;
  }
  const opened = new BrowserWindow({
    width: 1280,
    height: 860,
    title: app.name,
    webPreferences: { sandbox: true },
  });
  const { webContents } = opened;
  webContents.setWindowOpenHandler(({ url }) => {
    if (opensInBrowser(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The window shows the workbench and nothing else, wherever a link, a
  // redirect or a dropped file leads.
  const stay = (event: {
    url: string;
    isMainFrame: boolean;
    preventDefault(): void;
  }) => {
    if (!event.isMainFrame) return;
    const to = destination(event.url, settings.server, connectPage);
    if (to.kind === "workbench") return;
    event.preventDefault();
    if (to.kind === "address") void tryAddress(to.typed);
    if (to.kind === "browser") void shell.openExternal(to.url);
  };
  webContents.on("will-navigate", stay);
  webContents.on("will-redirect", stay);
  // A page with unsaved work keeps the window until the person lets it go.
  webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(opened, {
      type: "question",
      message: text.leaveHeading,
      detail: text.leaveDetail,
      buttons: [text.leave, text.stay],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) event.preventDefault();
  });
  webContents.on("did-fail-load", (_event, code, _reason, _url, mainFrame) => {
    if (mainFrame && code !== ERR_ABORTED && settings.server !== null)
      void askForWorkbench(settings.server);
  });
  const navigated = () => supervisor?.navigated();
  webContents.on("did-navigate", navigated);
  webContents.on("did-navigate-in-page", navigated);
  opened.on("closed", () => {
    window = null;
  });
  window = opened;
  return opened;
}

function showWindow(): void {
  if (window === null) void showWorkbench();
  else frontWindow();
}

session.defaultSession.setPermissionRequestHandler(
  (_contents, permission, grant) => grant(PERMITTED.has(permission)),
);
session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
  PERMITTED.has(permission),
);
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]),
);
// The app keeps serving from the menu bar with its window closed.
app.on("window-all-closed", () => {});
app.on("activate", showWindow);
app.on("second-instance", showWindow);
finishBeforeQuit(
  app,
  () => {
    acceptingConnections = false;
    return connections.run(async () => {
      await supervisor?.close();
      await writes.run(async () => {});
    });
  },
  (error) => {
    acceptingConnections = true;
    const detail = error instanceof Error ? error.message : String(error);
    record(detail);
    dialog.showErrorBox(app.getName(), detail);
  },
);
setInterval(() => void supervisor?.update(), UPDATE_CHECK_MS);
setInterval(() => void offerRelease(), RELEASE_CHECK_MS);

serve();
void offerRelease();
await showWorkbench();
