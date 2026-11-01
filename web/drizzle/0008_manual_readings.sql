CREATE TABLE "experiment_manual_readings" (
	"experiment_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"tally" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experiment_manual_readings_experiment_id_unit_id_observation_id_pk" PRIMARY KEY("experiment_id","unit_id","observation_id"),
	CONSTRAINT "experiment_manual_readings_tally_check" CHECK (jsonb_typeof("experiment_manual_readings"."tally") = 'object')
);
--> statement-breakpoint
ALTER TABLE "experiment_manual_readings" ADD CONSTRAINT "experiment_manual_readings_experiment_id_unit_id_experiment_units_experiment_id_id_fk" FOREIGN KEY ("experiment_id","unit_id") REFERENCES "public"."experiment_units"("experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_manual_readings" ADD CONSTRAINT "experiment_manual_readings_experiment_id_observation_id_experiment_observations_experiment_id_id_fk" FOREIGN KEY ("experiment_id","observation_id") REFERENCES "public"."experiment_observations"("experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_manual_readings_observation_idx" ON "experiment_manual_readings" USING btree ("experiment_id","observation_id");