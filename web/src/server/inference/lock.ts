import { sql } from "drizzle-orm";

import type { Executor } from "../infra/db/client";

/**
 * Serializes every write that decides what is recorded for one image under
 * one model version. The key differs in shape from an image digest, so the
 * lock never collides with `lockImage`.
 */
export async function lockDetection(
  digest: string,
  versionId: string,
  db: Executor,
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${digest}:${versionId}`}))`,
  );
}
