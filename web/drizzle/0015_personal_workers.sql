ALTER TABLE "training_runs" ADD COLUMN "sender_id" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workers_owner_idx" ON "workers" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "worker_sessions" DROP COLUMN "memory_bytes";