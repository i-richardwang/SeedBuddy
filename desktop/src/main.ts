import { app, dialog } from "electron";

// Electron holds `ready` back until this module has run, so the app, which
// works with what is there once Electron is ready, is a module loaded then.
if (app.requestSingleInstanceLock())
  void app
    .whenReady()
    .then(() => import("./app"))
    .catch((error: unknown) => {
      dialog.showErrorBox(
        app.name,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      app.exit(1);
    });
else app.exit();
