# Desktop app

The desktop app (`desktop/`) is the [SeedBuddy](../README.md) workbench in a window of its own, on a Mac that serves as a personal Worker while the app runs. It needs a workbench to connect to and does nothing without one. It runs on Apple Silicon.

## Install

Download the `.dmg` of the latest release named SeedBuddy on the [releases page](https://github.com/i-richardwang/SeedBuddy/releases), open it and drag SeedBuddy into Applications.

The app carries no Apple developer signature, so macOS refuses it the first time it is opened. Choose Done, then open System Settings → Privacy & Security and choose Open Anyway beside SeedBuddy; this is asked once.

The app does not update itself. Once a later version is published its menu offers the download, and the new copy replaces the one in Applications. The Worker runtime is no part of the download: the app installs the one its workbench ships and replaces it when the workbench ships another, as [How it serves](#how-it-serves) describes.

## What it does

On first launch the app asks for the address of a workbench and opens it once a workbench answers there; an address that leads on to another site is not taken for one. The window shows that workbench and nothing else: a link or a redirect to another site opens in the browser, a file dropped on the window opens nowhere, and a page may copy text to the clipboard but is granted no other permission. A page with unsaved work asks before the window leaves it, as a browser does.

While the app runs, the computer serves the workbench it is connected to as a [personal Worker](seedctl.md#workers) of the account that signed in. It detects for everyone and trains only the runs its owner sends it by name. Nobody enrolls it by hand, installs anything or copies a token: signing in is enough.

The menu bar item says what the computer is doing as a Worker, in the system's language, and holds the controls. Use this computer as a Worker turns serving off and on. Change workbench leaves the workbench for another: the Worker process is stopped at once, during a training run too, and the enrollment is given up, so the Worker stays listed on the workbench it left, offline, until someone removes it there. Closing the window leaves the app serving from the menu bar; quitting asks the Worker process to finish. A training run keeps the computer from idle sleep until it ends.

The computer stays the Worker of the account that enrolled it, whoever signs in to the window later. Removing the Worker on the workbench's Workers page stops it and turns serving off; turning serving on again enrolls the computer for the account signed in then. Suspending the account stops it until the account is reinstated.

Connecting to a workbench trusts it: the app installs and runs the Python package that workbench ships. Connect to a workbench you would set a Worker up for, over https unless it runs on this computer or a network you trust.

## How it serves

`supervisor.ts` decides, and the other modules each do one thing it asks for:

1. **The runtime** (`workbench.ts`, `runtime.ts`). The app carries [uv](https://docs.astral.sh/uv/) and installs [the Worker package the workbench ships](seedctl.md#install), with its own Python, into the app's data folder, apart from any `seedctl` the computer already has. It asks the workbench which package it ships (`GET /worker-package.json`), downloads that file, checks it against the digest described, and installs it from the copy it checked. uv reads the user's own uv configuration, so a package index or Python mirror set there applies. The digest installed is recorded, so a workbench deployed again with another package is noticed: every 15 minutes the app asks, and replaces the runtime unless the Worker is training.
2. **Enrollment** (`workbench.ts`). `POST /api/personal-workers` enrolls the computer under a name made of its host name and a random suffix, as the account whose session the window holds. With nobody signed in the app waits for a sign-in and tries again when the window navigates. A name another Worker holds is given up for a new one.
3. **The Worker process** (`worker.ts`). `seedctl worker setup --no-service` saves the profile, the token piped on standard input, and `seedctl worker run` runs it as the app's child under a `SEEDBUDDY_HOME` in the app's data folder; no LaunchAgent is involved. The app reads the state the process records in its profile's `status.json`, and how it ended on its own decides what follows: a Worker removed in the workbench stays out, a suspended account's Worker is tried again in five minutes, and any other end is shown and tried again in half a minute—which also installs the package of a workbench that now speaks another protocol revision. A Worker process still there from an earlier run of the app, one that was killed or that quit while the process was finishing, is ended before another starts.

The supervisor reaches all of this through ports, so its decisions are tested without a workbench, a runtime or a process; `app.ts` supplies them, with the window and the menu bar item, and `navigation.ts` decides where a navigation of the window leads. It does one thing at a time, and turning serving off, changing workbench and quitting drop the step under way: an install or a setup that is running is ended.

The app's data folder holds `settings.json` (the workbench address, the Worker name, whether the profile is enrolled and whether the computer serves), the runtime under `runtime/`, and the Worker's home under `worker/`, with the profile's `worker.log`. The Worker token lives only in the profile `seedctl` keeps, with mode `0600`. What last kept the computer from serving is shown in the menu, and what last went wrong, that or settings that could not be saved, is kept in full in `failure.log`.

## Development

```bash
cd desktop
bun install --frozen-lockfile
bun run dev
```

`bun run dev` fetches the pinned uv into `resources/`, builds the main process into `dist/` and starts Electron. Against a development workbench, [ship a Worker package](development.md#setup) first. `bun run package` builds `release/SeedBuddy-<version>-mac-arm64.dmg` and, in `release/mac-arm64/`, the app it holds. The app is signed ad hoc, with no developer identity: an Apple Silicon Mac runs no code without a signature.

`make check-desktop` runs the build, the Prettier check, Biome lint, TypeScript and the tests.

## Release

`version` in `desktop/package.json` is the app's version. To publish it, push the tag `desktop-v<version>` from the commit to release:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The Desktop package workflow builds the `.dmg` on a GitHub-hosted Mac and publishes it as the release of that tag, with the notes in `desktop/release-notes.md`; a tag that does not name the version fails. The same workflow builds the `.dmg` of every pull request that changes `desktop/`, kept for a week as an artifact of the run and published nowhere.

Running copies learn of the release from GitHub (`release.ts`): at launch and once a day the app reads the repository's releases and offers the latest `desktop-v` one after its own version.
