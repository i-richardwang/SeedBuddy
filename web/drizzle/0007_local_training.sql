-- Bind existing execution records to the machine that owns their recovery files.
UPDATE training_runs AS run
SET checkpoint = jsonb_build_object('attempt', (run.checkpoint->>'attempt')::integer,
    'epoch', (run.checkpoint->>'epoch')::integer, 'workerId', execution.worker_id)
FROM training_attempts AS execution
WHERE run.checkpoint IS NOT NULL AND execution.run_id = run.id
  AND execution.attempt = (run.checkpoint->>'attempt')::integer;
--> statement-breakpoint
UPDATE training_runs SET target_worker_id = COALESCE(checkpoint->>'workerId', worker_id, target_worker_id)
WHERE checkpoint IS NOT NULL OR status = 'running';
--> statement-breakpoint
UPDATE training_attempts SET finished_at = now(), outcome = 'paused'
WHERE finished_at IS NULL;
--> statement-breakpoint
UPDATE training_runs SET status = 'paused', worker_id = NULL, session_id = NULL,
  lease_expires_at = NULL, phase = NULL, progress = NULL
WHERE status = 'running';
