# Seed annotation coordinator

The parent dispatches annotators directly; no coordination-only or reviewer child agents.

1. Read the requested image's annotation state and save a before snapshot when starting another run. Continue an authorized active run. For initial annotation start with input=null; for maintenance use the stored proposal, otherwise the applicable review/detection. Scope is normally null. Cancel/restart only when the user explicitly requests a fresh run; never automatically replace completed work.
2. Launch a fresh subagent with fork_turns=none and annotator.md, one image ref/run ID, output location and available references. Give it only compact checkpoint/pending information, not previous visual history. Keep at most four active images, with one annotator per image.
3. Each annotator ends after at most 12 accepted regions or 15 minutes. This is an end-of-session boundary, not a progress interval. To continue, dispatch another fresh annotator on the same server run; do not followup the old annotator or assign multi-image queues.
4. Verify receipts and live progress. Stop dispatch when the user stops the task or a blocking failure needs attention. Preserve checkpoints; avoid repeated retries. Do not infer current counts from a prior published proposal while a run is active.
5. Report whole-image completion only after the service confirms it. Report uncertainty and coverage limitations and whether a human review takes precedence. Do not automatically rerun completed images or bypass coverage/model settings.
