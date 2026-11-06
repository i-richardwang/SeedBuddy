-- A model's area is a setting of the task, not of how an agent annotates it:
-- it governs AI annotation, training and inference alike. Lift it out of the
-- annotation document, and freeze it on every snapshot taken from now on.
ALTER TABLE "models" ADD COLUMN "area" text;--> statement-breakpoint
UPDATE "models" SET "area" = COALESCE("annotation"->>'area', 'image');--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "area" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_area_check" CHECK ("models"."area" in ('image', 'dish'));--> statement-breakpoint
UPDATE "models" SET "annotation" = "annotation" - 'area';--> statement-breakpoint
-- Every snapshot so far trained on whole images, whatever its model's area.
ALTER TABLE "dataset_snapshots" ADD COLUMN "area" text NOT NULL DEFAULT 'image';--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ALTER COLUMN "area" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_area_check" CHECK ("dataset_snapshots"."area" in ('image', 'dish'));--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD COLUMN "coverage" jsonb;--> statement-breakpoint
-- Trained versions record the frame they read; every version so far reads
-- the whole image. The artifact digest hashes the numeric settings only, so
-- the identity of these versions is unchanged.
UPDATE "model_versions"
SET "artifact" = jsonb_set("artifact", '{inference,mode}', '"whole_image"')
WHERE "artifact"->>'kind' = 'ultralytics' AND NOT ("artifact"->'inference' ? 'mode');
