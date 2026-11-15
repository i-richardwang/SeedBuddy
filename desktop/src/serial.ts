/**
 * Runs tasks one at a time, in the order they were asked for. One that fails
 * rejects for whoever asked and does not hold up those behind it.
 */
export class Serial {
  #last: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const done = this.#last.then(task);
    this.#last = done.catch(() => {});
    return done;
  }
}
