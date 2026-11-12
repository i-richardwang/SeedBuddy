import { sql } from "drizzle-orm";

import type { Connection, Executor } from "./connection";

export type { Executor } from "./connection";

/**
 * A connection outlives hot-reloaded server modules. The process owns the
 * pool, so its promise lives on the runtime and a failed open remains retryable.
 */
interface DatabaseHandle {
  ready?: Promise<Connection>;
  initialize?: () => Promise<Connection>;
}

const HANDLE: unique symbol = Symbol.for("seedbuddy.database");
const runtime = globalThis as typeof globalThis & {
  [HANDLE]?: DatabaseHandle;
};
runtime[HANDLE] ??= {};
const handle: DatabaseHandle = runtime[HANDLE];

/** The process entry point supplies initialization; drivers do not know application data. */
export function configureDatabase(initialize: () => Promise<Connection>): void {
  handle.initialize = initialize;
}

/** The initialized application database, opened on first use. */
export async function database(): Promise<Executor> {
  if (!handle.initialize) {
    throw new Error(
      "Database is not configured; call bootstrap() at the process entry point",
    );
  }
  handle.ready ??= handle.initialize().catch((error: unknown) => {
    handle.ready = undefined;
    throw error;
  });
  return (await handle.ready).db;
}

/** Release the process-owned connection after its work has finished. */
export async function closeDatabase(): Promise<void> {
  const ready = handle.ready;
  if (!ready) return;
  try {
    await (await ready).close();
  } finally {
    if (handle.ready === ready) handle.ready = undefined;
  }
}

/** Run work inside one transaction on the application database. */
export async function transaction<T>(
  work: (db: Executor) => Promise<T>,
): Promise<T> {
  const db = await database();
  return db.transaction((db) => work(db));
}

/** Join an existing unit of work or open one for a standalone domain call. */
export function inTransaction<T>(
  db: Executor | undefined,
  work: (db: Executor) => Promise<T>,
): Promise<T> {
  return db ? work(db) : transaction(work);
}

/** Run several reads against one snapshot of the application database. */
export async function snapshot<T>(
  work: (db: Executor) => Promise<T>,
): Promise<T> {
  const db = await database();
  return db.transaction((db) => work(db), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/** Read within an existing unit of work or open a snapshot for a standalone read. */
export function inSnapshot<T>(
  db: Executor | undefined,
  work: (db: Executor) => Promise<T>,
): Promise<T> {
  return db ? work(db) : snapshot(work);
}

/** Sample the database wall clock once per operation after acquiring its ownership lock;
 * reuse that instant for predicates, fences and lease expiry. Tests may supply the instant.
 */
export async function operationTime(
  db: Executor,
  suppliedAt?: Date,
): Promise<Date> {
  if (suppliedAt) return suppliedAt;
  const [row] = await db
    .select({ at: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock`);
  if (!row) throw new Error("Database clock returned no instant");
  return new Date(row.at);
}

/** A row guaranteed by an insert or a locked foreign key; absence is a storage invariant failure. */
export function single<T>(rows: readonly T[], table: string): T {
  const [row] = rows;
  if (!row) throw new Error(`Expected a row from ${table}`);
  return row;
}
