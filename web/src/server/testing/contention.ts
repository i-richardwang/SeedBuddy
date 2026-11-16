import { test } from "bun:test";
import postgres from "postgres";

/**
 * Two sessions can only meet on a real server, so the database a run is
 * pointed at decides whether a contended case is exercised.
 */
export const testDatabaseUrl = process.env.SEEDBUDDY_TEST_DATABASE_URL;
export const contendedTest = testDatabaseUrl ? test : test.skip;

/** Returns once a session is waiting on a lock another session holds. */
export async function waitForLockContention(url: string): Promise<void> {
  const observer = postgres(url, { max: 1, onnotice: () => {} });
  try {
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    const deadline = Date.now() + 5_000;
    /** Test wall clock anchors the fixture or expiry assertion relative to the live database. */
    while (Date.now() < deadline) {
      const [waiting] = await observer<{ sessions: number }[]>`
        select count(*)::int as sessions from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `;
      if ((waiting?.sessions ?? 0) > 0) return;
      await Bun.sleep(10);
    }
    throw new Error("No session ever waited for a lock");
  } finally {
    await observer.end();
  }
}
