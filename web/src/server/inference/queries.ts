import { type SQLWrapper, sql } from "drizzle-orm";

/**
 * The version that reads for a model: the one a person made current. A
 * trained version is a candidate until then, and a model with no current
 * version leaves its images for a reviewer instead of a worker.
 */
export function currentVersion(modelId: SQLWrapper | string) {
  return sql`(
    select m.current_version_id
    from models m
    where m.id = ${modelId}
  )`;
}

/**
 * The version whose detection a person is shown for the image: the current
 * one once it has detected the image, else the newest of the model's
 * versions that has, so a reviewer still starts from something while the
 * current version catches up.
 */
export function shownDetectingVersion(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return sql`coalesce(
    (
      select d.model_version_id
      from inference_outcomes d
      join models m on m.current_version_id = d.model_version_id
      where d.image_id = ${imageId}
        and m.id = ${modelId}
    ),
    (
      select d.model_version_id
      from inference_outcomes d
      join model_versions v on v.id = d.model_version_id
      where d.image_id = ${imageId}
        and v.model_id = ${modelId}
      order by v.created_at desc, v.id desc
      limit 1
    )
  )`;
}
