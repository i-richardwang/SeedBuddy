import { describe, expect, test } from "bun:test";

import { database } from "../infra/db/client";
import type { Connection } from "../infra/db/connection";
import { prepareDatabase } from "./preparation";

describe("preparing a connection", () => {
  test("serves the database once it is migrated", async () => {
    const db = await database();
    const connection: Connection = {
      db,
      migrate: () => Promise.resolve(),
      close: () =>
        Promise.reject(new Error("A prepared connection stays open")),
    };
    expect(await prepareDatabase(connection)).toBe(connection);
  });

  test("releases the connection it cannot migrate", async () => {
    let closed = false;
    const connection: Connection = {
      db: await database(),
      migrate: () => Promise.reject(new Error("Migration failed")),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    await expect(prepareDatabase(connection)).rejects.toThrow(
      "Migration failed",
    );
    expect(closed).toBe(true);
  });
});
