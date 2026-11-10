-- A version finds the classes it was made to find, and a snapshot trains the
-- classes its model declared when it froze. Both were read from the model
-- while a model's classes never changed; record them where they belong before
-- the seed model declares more. The traditional detector calls every seed
-- ungerminated; every other version so far finds all its model's classes.
ALTER TABLE "model_versions" ADD COLUMN "classes" jsonb;--> statement-breakpoint
UPDATE "model_versions" AS "version"
SET "classes" = CASE
  WHEN "version"."artifact"->>'kind' = 'traditional' THEN '["ungerminated"]'::jsonb
  ELSE "model"."classes"
END
FROM "models" AS "model"
WHERE "model"."id" = "version"."model_id";--> statement-breakpoint
ALTER TABLE "model_versions" ALTER COLUMN "classes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD COLUMN "classes" jsonb;--> statement-breakpoint
UPDATE "dataset_snapshots" AS "snapshot"
SET "classes" = "model"."classes"
FROM "models" AS "model"
WHERE "model"."id" = "snapshot"."model_id";--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ALTER COLUMN "classes" SET NOT NULL;--> statement-breakpoint
-- Which classes a day counts unless it names its own becomes a setting of the
-- model. Every day so far counted every class unless it named fewer.
ALTER TABLE "models" ADD COLUMN "counted_classes" jsonb;--> statement-breakpoint
UPDATE "models" SET "counted_classes" = "classes";--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "counted_classes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_counted_classes_check" CHECK (jsonb_typeof("models"."counted_classes") = 'array' and jsonb_array_length("models"."counted_classes") > 0);--> statement-breakpoint
-- A model declares at most six classes, one for each color its boxes are
-- drawn in. A deployment holding a model that declares more stops here, with
-- nothing changed, rather than fail wherever its models are listed.
ALTER TABLE "models" ADD CONSTRAINT "models_classes_check" CHECK (jsonb_typeof("models"."classes") = 'array' and jsonb_array_length("models"."classes") between 1 and 6);--> statement-breakpoint
-- The seed model tells two more states apart: a seed with no embryo, and one
-- whose embryo died. What was recorded while it told two apart keeps its
-- meaning. A day that counted both states counted every seed, and goes on
-- counting every seed however its photographs are read from now on.
UPDATE "experiment_observations"
SET "counted_classes" = '["ungerminated", "germinated", "empty", "dead"]'::jsonb
WHERE "model_id" = 'seed-detector'
  AND "counted_classes" = '["ungerminated", "germinated"]'::jsonb;--> statement-breakpoint
-- A person who gave both states sorted every seed they counted into one of
-- them, so their count holds none in the states that did not exist yet, and
-- stays an answer whichever of the four its day comes to count.
UPDATE "experiment_manual_readings" AS "reading"
SET "tally" = '{"empty": 0, "dead": 0}'::jsonb || "reading"."tally"
FROM "experiment_observations" AS "observation"
WHERE "observation"."experiment_id" = "reading"."experiment_id"
  AND "observation"."id" = "reading"."observation_id"
  AND "observation"."model_id" = 'seed-detector'
  AND "reading"."tally" ? 'ungerminated'
  AND "reading"."tally" ? 'germinated';--> statement-breakpoint
-- The new states join after the classes the model had, so every tally,
-- review, counted class and label index already stored keeps its meaning.
-- A seed without an embryo was never going to germinate, so from now on a
-- day counts the seeds that hold one unless it asks otherwise.
UPDATE "models"
SET "classes" = "classes" || '["empty", "dead"]'::jsonb,
    "counted_classes" = '["ungerminated", "germinated", "dead"]'::jsonb
WHERE "id" = 'seed-detector';--> statement-breakpoint
-- Its annotation instructions are the deployment's to edit: the ones it
-- shipped with give way to the ones that describe four states, and any a
-- person has rewritten stay as they wrote them.
UPDATE "models"
SET "annotation" = jsonb_set("annotation", '{instructions}', to_jsonb('Box every visible seed separately, whatever its state, and give each box one of
four states. A seed is germinated once a radicle or shoot has visibly broken
through its coat, and stays germinated whatever becomes of it. A seed that has
not germinated is empty when its coat holds no embryo, flat or hollow with
nothing filling it; dead when its embryo has visibly died, darkened, collapsed
or rotting; and ungerminated otherwise. Mark a box uncertain when its state
cannot be told. Enclose the seed body together with any radicle or shoot that
emerged from it. Seeds include opaque brown/gold and pale yellow/translucent
bodies with a coherent elongated outline; enclose the complete visible body,
including pale coat and tips, before minimizing background. Distinguish seeds
and their radicles and shoots from fibers and glare. Inspect touching clusters
for separate bodies at different angles; their rectangles may overlap naturally.
Do not force an expected count or mechanically shrink, expand or pad boxes.'::text))
WHERE "id" = 'seed-detector' AND md5("annotation"->>'instructions') = '333dcdb8b3e7867be017a2448bc4b4a6';
