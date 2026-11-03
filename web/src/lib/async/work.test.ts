import { expect, test } from "bun:test";

import { createSingleFlight, createWorkGate } from "./work";

test("admission is FIFO and a failure releases capacity", async () => {
  const run = createWorkGate(2);
  let active = 0,
    peak = 0;
  const started: number[] = [];
  const jobs = Array.from({ length: 8 }, (_, id) =>
    run(async () => {
      started.push(id);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active--;
      if (id === 2) throw new Error("failed work");
      return id;
    }),
  );
  const results = await Promise.allSettled(jobs);
  expect(peak).toBe(2);
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(results[2]?.status).toBe("rejected");
  expect(await run(async () => "ready")).toBe("ready");
});

test("concurrent callers share work and a rejected attempt can be retried", async () => {
  const run = createSingleFlight<number>();
  let attempts = 0;
  const fail = () => {
    attempts++;
    throw new Error("unavailable");
  };
  const first = run("asset", async () => fail());
  expect(run("asset", async () => 0)).toBe(first);
  await expect(first).rejects.toThrow("unavailable");
  expect(await run("asset", async () => ++attempts)).toBe(2);
  expect(await run("asset", async () => ++attempts)).toBe(3);
});
