-- The instances per class in a detection, proposal or annotation document.
-- Every stored document was parsed against its schema when it was written, so
-- `instances` is an array of instances that each name a class. Immutable, so a
-- document's tally is generated beside it when it is written.
CREATE FUNCTION document_tally(document jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  select coalesce(jsonb_object_agg(instance.class, instance.total), '{}'::jsonb)
  from (
    select item->>'class' as class, count(*) as total
    from jsonb_array_elements(document->'instances') as item
    group by 1
  ) as instance
$$;--> statement-breakpoint
-- A unit code as units are ordered by: each run of digits padded to the
-- longest a code can hold (60 characters, as `experiment_units_code_check`
-- bounds it), so numbers compare by value, and letters in lower case.
-- Compared bytewise (collate "C"), `T1-2` precedes `T1-10`.
CREATE FUNCTION unit_code_order(code text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  select coalesce(string_agg(
    case when part[1] ~ '^[0-9]' then lpad(part[1], 60, '0') else lower(part[1]) end,
    '' order by position
  ), '')
  from regexp_matches(code, '[0-9]+|[^0-9]+', 'g') with ordinality as match(part, position)
$$;--> statement-breakpoint
ALTER TABLE "annotation_runs" ADD COLUMN "tally" jsonb GENERATED ALWAYS AS (document_tally(result->'document')) STORED;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "tally" jsonb GENERATED ALWAYS AS (document_tally(document)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_units" ADD COLUMN "code_order" text GENERATED ALWAYS AS (unit_code_order(code)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD COLUMN "tally" jsonb GENERATED ALWAYS AS (document_tally(document)) STORED NOT NULL;--> statement-breakpoint
-- A day's photographs and culture events, found by the day: whether it holds
-- records, and what deleting it removes.
CREATE INDEX "experiment_culture_events_observation_idx" ON "experiment_culture_events" USING btree ("experiment_id","observation_id");--> statement-breakpoint
CREATE INDEX "experiment_observation_images_observation_idx" ON "experiment_observation_images" USING btree ("experiment_id","observation_id");