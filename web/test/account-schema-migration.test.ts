import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

/** Upgrade a populated database, not just an empty final schema. */
test("removing account issuer preserves credentials and provider identity", async () => {
  const db = new PGlite();
  try {
    const journal = await Bun.file("drizzle/meta/_journal.json").json();
    for (const entry of journal.entries) {
      if (entry.tag === "0009_remove_account_issuer") break;
      await db.exec(await Bun.file(`drizzle/${entry.tag}.sql`).text());
    }
    await db.exec(`
      INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at)
      VALUES ('owner', 'Owner', 'owner@example.test', true, 'admin', now(), now());
      INSERT INTO accounts (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at)
      VALUES ('account', 'owner', 'old-issuer', 'owner', 'credential', 'password-hash', now(), now());
    `);
    await db.exec(
      await Bun.file("drizzle/0009_remove_account_issuer.sql").text(),
    );
    const account = await db.query(
      "SELECT id, user_id, account_id, provider_id, password FROM accounts",
    );
    expect(account.rows).toEqual([
      {
        id: "account",
        user_id: "owner",
        account_id: "owner",
        provider_id: "credential",
        password: "password-hash",
      },
    ]);
    const removed = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'issuer'",
    );
    expect(removed.rows).toEqual([]);
  } finally {
    await db.close();
  }
});
