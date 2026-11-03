import { sql } from "drizzle-orm";

import type { Executor } from "../infra/db/client";

/** Discover missing work independently of worker capabilities or availability. */
export async function materializeInferenceDemand(
  tx: Executor,
  at: Date,
): Promise<void> {
  await tx.execute(sql`
    with demand as (
      select distinct i.image_id, m.current_version_id as model_version_id
      from experiment_observation_images i
      join experiment_observations o on o.experiment_id=i.experiment_id and o.id=i.observation_id
      join models m on m.id=o.model_id
      where m.current_version_id is not null
      union
      select distinct i.image_id, v.id
      from model_versions c join models m on m.id=c.model_id
      join dataset_snapshot_images i on i.snapshot_id=c.source_dataset_snapshot_id and i.split='val'
      join model_versions v on v.id=c.id or v.id=m.current_version_id
      where m.current_version_id is distinct from c.id
    )
    insert into inference_tasks (image_id, model_version_id, status, created_at, available_at)
    select d.image_id, d.model_version_id, 'queued', ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz
    from demand d
    where not exists (select 1 from inference_outcomes o where o.image_id=d.image_id and o.model_version_id=d.model_version_id)
    order by d.model_version_id, d.image_id
    on conflict do nothing
  `);
}
