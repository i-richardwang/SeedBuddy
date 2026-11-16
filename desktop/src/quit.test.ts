import { EventEmitter } from "node:events";

import { expect, test } from "bun:test";

import { finishBeforeQuit } from "./quit";

class Application extends EventEmitter {
  exited = false;
  quit() {
    let prevented = false;
    this.emit("before-quit", {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!prevented) this.exited = true;
  }
}

test("quit waits for cleanup, coalesces requests and can retry a failed cleanup", async () => {
  const app = new Application();
  let cleanup = Promise.withResolvers<void>();
  let attempts = 0;
  const errors: unknown[] = [];
  finishBeforeQuit(
    app,
    () => {
      attempts++;
      return cleanup.promise;
    },
    (error) => errors.push(error),
  );
  app.quit();
  app.quit();
  expect(attempts).toBe(1);
  expect(app.exited).toBe(false);
  const failure = new Error("cleanup pending");
  cleanup.reject(failure);
  await Promise.resolve();
  expect(errors).toEqual([failure]);
  expect(app.exited).toBe(false);
  cleanup = Promise.withResolvers<void>();
  app.quit();
  expect(attempts).toBe(2);
  expect(app.exited).toBe(false);
  cleanup.resolve();
  await Promise.resolve();
  expect(app.exited).toBe(true);
});
