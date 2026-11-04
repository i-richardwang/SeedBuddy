import { sql } from "drizzle-orm";

import type { Executor } from "../infra/db/client";

/**
 * Serializes operations that may create or remove one image's bytes. Every
 * participant locks digests in sorted order when it handles more than one.
 */
export async function lockImage(digest: string, db: Executor): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${digest}))`);
}
