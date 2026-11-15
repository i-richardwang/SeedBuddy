import { expect, test } from "bun:test";

import { Serial } from "./serial";

test("tasks run one at a time in the order asked", async () => {
  const serial = new Serial();
  const first = Promise.withResolvers<void>();
  const ran: string[] = [];

  const slow = serial.run(async () => {
    await first.promise;
    ran.push("first");
  });
  const quick = serial.run(async () => {
    ran.push("second");
    return 2;
  });
  first.resolve();

  expect(await quick).toBe(2);
  await slow;
  expect(ran).toEqual(["first", "second"]);
});

test("a task that fails rejects and those behind it still run", async () => {
  const serial = new Serial();

  const failing = serial.run(() => Promise.reject(new Error("disk full")));
  const next = serial.run(async () => "ran");

  await expect(failing).rejects.toThrow("disk full");
  expect(await next).toBe("ran");
});
