import { type AnyColumn, type SQL, sql } from "drizzle-orm";

import type { Tally } from "../../domain/models/classes";

/**
 * The instances per class in a stored detection, proposal or annotation
 * document, counted in the database. A document with no instances, or none
 * at all, counts nothing.
 */
export function documentTally(document: SQL | AnyColumn) {
  return sql<Tally>`(select coalesce(jsonb_object_agg(instance.class, instance.total), '{}'::jsonb) from (select item->>'class' as class, count(*) as total from jsonb_array_elements(${document}->'instances') as item group by 1) as instance)`;
}
