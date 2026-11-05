import { type AnyColumn, type SQL, sql } from "drizzle-orm";

import type { Tally } from "../../domain/models/classes";

/**
 * The instances per class in a stored detection, proposal or annotation
 * document, counted in the database by `document_tally`, the function the
 * stored readings generate their `tally` columns with. A document with no
 * instances, or none at all, counts nothing. Prefer a reading's own `tally`
 * column; this is for documents kept elsewhere, such as a snapshot's.
 */
export function documentTally(document: SQL | AnyColumn) {
  return sql<Tally>`coalesce(document_tally(${document}), '{}'::jsonb)`;
}
