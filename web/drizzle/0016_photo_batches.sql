CREATE TABLE "photo_batch_photos" (
	"batch_id" uuid NOT NULL,
	"image_id" text NOT NULL,
	"filename" text NOT NULL,
	CONSTRAINT "photo_batch_photos_batch_id_image_id_pk" PRIMARY KEY("batch_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "photo_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "photo_batches_name_check" CHECK ("photo_batches"."name" = btrim("photo_batches"."name") and length("photo_batches"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "photo_batch_photos" ADD CONSTRAINT "photo_batch_photos_batch_id_photo_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."photo_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_batch_photos" ADD CONSTRAINT "photo_batch_photos_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_batches" ADD CONSTRAINT "photo_batches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_batch_photos_image_idx" ON "photo_batch_photos" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "photo_batches_owner_idx" ON "photo_batches" USING btree ("owner_id","created_at");