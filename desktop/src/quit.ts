/** The application cannot leave while it still owns asynchronous cleanup. */
export function finishBeforeQuit(
  app: {
    on(
      event: "before-quit",
      listener: (event: { preventDefault(): void }) => void,
    ): unknown;
    quit(): void;
  },
  cleanup: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  let state: "open" | "closing" | "closed" = "open";
  app.on("before-quit", (event) => {
    if (state === "closed") return;
    event.preventDefault();
    if (state === "closing") return;
    state = "closing";
    void cleanup().then(
      () => {
        state = "closed";
        app.quit();
      },
      (error: unknown) => {
        state = "open";
        onError(error);
      },
    );
  });
}
