# vitroctl

Operator CLI and native Worker runtime for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Workers that detect and train for it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, and `traditional` commands run wherever Python 3.11+ is available.

## Install

```bash
uv tool install 'vitroctl[yolo]'
```

The `yolo` extra installs the pinned Ultralytics runtime that Workers advertise. Without it, a Worker serves the bundled traditional detector and takes no training runs.

## Workers

An administrator enrolls each machine on the workbench's Workers settings page, which shows the machine's token once. Each Worker profile holds that token and a private work directory; the workbench knows the worker by its token. Setup validates the token, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
vitroctl worker setup mac-studio \
  --server https://<workbench> \
  --device mps
```

The token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
vitroctl worker list
vitroctl worker status mac-studio
vitroctl worker doctor mac-studio
vitroctl worker logs mac-studio --follow
vitroctl worker restart mac-studio
vitroctl worker stop mac-studio
```

`launchd` restarts a Worker that crashes. A Worker whose machine is removed from the Workers page stops and stays stopped, and `worker list` shows why; enroll the machine again and rerun `setup --force` with the new token.

`stop` and `restart` return once the Worker has exited; `restart` then loads the current LaunchAgent definition. Training runs in a supervised child process, so shutdown or detection of a revoked lease stops even a trainer blocked inside a GPU operation. The server revokes ownership immediately; the Worker detects revocation on its next training request or lease renewal. Each attempt uses a private directory. Completed but undelivered bundles are retained; other attempt directories are removed when execution exits.

Inference uses one execution slot per Worker. Unstarted images remain on the server. Each assignment carries a unique attempt number, a renewable 90-second lease and a fixed execution deadline; the Worker renews every 20 seconds. The deadline includes downloading, cold model loading and prediction: 10 minutes for traditional detection, and 12–30 minutes for Ultralytics according to inference image size. Network exchanges and child-process supervision remain bounded even when a GPU call or partial IPC reply stalls. Consecutive tasks reuse a warm inference process and the disk cache; training or a failed execution closes that process.

After a lost lease, execution deadline or transient error, the server retries up to three attempts. Retry delays are 5 and 10 seconds, and the failed Worker cools for 60 seconds. Terminal failures appear on the image review and in model comparisons. Retry from the image review, or use `retry-inference-task` through the experiment HTTP/MCP API for any image/version pair. `get-inference-task` returns state, deadlines and complete attempt history. Explicit retry starts a new budget without discarding history. A queued task with no available capable Worker remains waiting.

Deploy Web and Workers as one coordinated protocol update: stop Workers, deploy Web (startup applies migrations), then install and start the matching Worker package. The inference migration preserves successful detections and terminal failures and requeues unfinished leases. There is no mixed-version Worker protocol. Do not restart an old Worker package against the new server.

Training presets pin model weights, parameters, and the framework version. A run stores its resolved recipe; resuming does not consult the preset registry. The shared trainer limits validation to the actual per-device training batch and records effective execution parameters in the Worker profile log.

Workers validate both training recipes and the training metadata in published model manifests. A framework version match alone does not establish application-contract compatibility; shared-contract changes follow the coordinated deployment sequence above.

The training dialog assigns work automatically or to a specific enrolled Worker. A run's status on its page is the menu that controls it: **Pause training** revokes the current attempt and releases the model immediately; **Cancel training…** asks before it ends the task. Pausing a task frees its model for a new run; a paused or failed task continues once no other run of its model is in progress, on the training Worker its dialog names, from its saved epoch or from the beginning. A pinned task waits for its selected Worker rather than silently moving elsewhere.

Each epoch saves the latest resumable weights, best weights, and epoch journal on the Worker. Only metrics and the local recovery location are reported to the workbench; checkpoint bytes never leave the machine during training. A run becomes bound to its Worker when first claimed. Pause or contact loss retains its local state, and resume uses that same Worker. Selecting **Start from the beginning** discards the recovery reference and permits a different Worker. Missing or invalid files fail with an explicit restart instruction; machine or disk loss is not recoverable from the workbench.

Local recovery checks the run, frozen dataset snapshot, recipe, and Worker identity before atomically copying each recovery directory into the next attempt. The trainer verifies the checkpoint and epoch journal before resuming. Attempts with local weights or a finished bundle are excluded from automatic stale-run cleanup; their log identifies the retained directory. Remove retained directories explicitly when no longer needed.

Only the final model is uploaded. `PUT /api/worker/training/runs/:runId/artifact-parts` transfers sequential weight parts of at most 8 MiB, with a total limit of 512 MiB. `POST /api/worker/training/runs/:runId/artifact` submits the model manifest and publishes the verified weights. Part size and SHA-256, complete-file identity, recipe, and attempt ownership are checked before publication. Part retries and publication retries are idempotent. Maintenance removes parts after publication or after the attempt ends or expires. A failed delivery retains the finished bundle; retrying on the same Worker publishes it without training again.

The run page lists execution attempts and the last reported local checkpoint epoch. Lease renewal does not count as training progress. If a Worker loses contact, its run waits for that Worker; an operator can pause it and explicitly restart elsewhere. A held run without progress for 15 minutes shows a warning. Every execution request carries its session and attempt, so cancelled or superseded attempts cannot report progress or publish models.

`vitroctl worker run <profile>` runs a Worker in the foreground without `launchd`.

## Datasets

Dataset transfer uses `/api/transfer/` with a personal API key that holds the transfer scope:

```bash
export VITROFLOW_SERVER_URL=https://<workbench>
export VITROFLOW_API_KEY=<api-key>

vitroctl dataset pull --dataset fixtures --data-root data
vitroctl dataset push --dataset fixtures --data-root data
```

A local data root shares content-addressed blobs across datasets:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Annotations export as a deterministic YOLO dataset:

```bash
vitroctl dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

`vitroctl recognize` runs the bundled traditional detector over a pulled dataset, and `vitroctl traditional evaluate` and `vitroctl traditional train` score and retrain its candidate scorer from reviewed annotations.

## Training and model delivery

Training and model registration are independent. A Worker and local training produce the same **Model Bundle**: `bundle.json` and `weights.pt`. The manifest fixes ordered classes, weight digest and size, inference settings, the training recipe, runtime requirements, dataset provenance, and evaluation/calibration evidence. Checkpoints remain separate and are only needed to continue training.

A training specification is JSON with `dataset` and `recipe`. `recipe` has the same structure as the `recipe` member in `configs/yolo26/yolo26n-whole-v1.recipe.json`: pinned base-model reference and digest, training parameters, and framework version. Optional `nbs`, scale, rotation, flip, translation and HSV parameters override the pinned framework's defaults. The resolved scalar trainer arguments and a training-code fingerprint are saved in `training-context.json` and included in generated bundles. Final validation uses the actual bounded validation batch, including automatic batch reductions.

For local training, `dataset` is the name of a previously pulled dataset. For managed training, it is the workbench dataset ID returned by `list-datasets`.

```bash
# Local compute; no server or Worker registration required.
vitroctl training run --local --spec training.json --data-root data \
  --device mps --output output/my-training

# Continue an interrupted local run with exactly the same inputs.
vitroctl training run --local --resume --spec training.json --data-root data \
  --device mps --output output/my-training

# Workbench operations require an API key with the experiments scope.
vitroctl training workers
vitroctl training run --spec managed-training.json --worker mac-studio
vitroctl training list --model seed-detector
vitroctl training get <run-id>
vitroctl training pause <run-id> --dataset <dataset-id> --attempt 1
vitroctl training resume <run-id> --dataset <dataset-id> --attempt 1 --worker another-worker
vitroctl training cancel <run-id> --dataset <dataset-id> --attempt 2
```

Local outputs retain the fixed input manifest, exported data and split membership, checkpoints, epoch journal, inference summary, and `bundle/`. Resume checks the saved inputs before using a checkpoint; changing data or parameters requires another output directory. A completed training cannot be resumed from a stripped final checkpoint. Its bundle can still be imported repeatedly without training.

```bash
# Register a candidate; this never changes the current model selection.
vitroctl models import output/my-training/bundle --model seed-detector
vitroctl models list --model seed-detector

# Select the returned version ID explicitly. Selecting an earlier ID rolls back.
vitroctl models use --model seed-detector --version <version-id>
```

For existing experimental weights, prepare a manifest matching [the bundle contract](../src/vitroctl/contracts/model-bundle.schema.json). The `weights` descriptor can be omitted from the input metadata; `pack` computes it. Include the actual class order, chosen confidence and image size, original recipe, selected epoch if known, data fingerprint if available, and the separate calibration/evaluation descriptions. Unknown provenance is explicitly `null`; do not invent a snapshot or report full-dataset training for a subset experiment.

```bash
vitroctl models pack --weights output/experiment/weights/last.pt \
  --metadata experiment-bundle.json --output output/candidate
vitroctl models import output/candidate --model seed-detector
```

Packaging and CLI import load the weights on CPU to verify their ordered classes and require the declared Ultralytics version. The supported delivery pipeline is `mode: "whole_image"` with explicit `iou: 0.7`. Tiling or another IoU is rejected instead of silently changing the experiment's inference behavior. Such pipelines require an adapter and contract extension before they can be registered. Registration validates metadata and byte identity; a reported accuracy metric is provenance, not a platform-certified score. Imported versions remain candidates until selected.

The workbench uses content-derived upload identities and version identities covering the entire bundle and its origin. Repeating import safely returns the same version; changing inference settings creates another version even with identical weights. Upload reservations expire after 24 hours unless registered, and preparing the same bundle renews the reservation. Upload and registration are separate so connection failures can be retried. Delivered versions retain their immutable bytes independently of their training run.

A Worker retains a finished bundle in its attempt directory if publication fails, and this directory is excluded from stale-run cleanup. Import that bundle with the CLI to recover the completed work. A successful publication removes the current local attempt directory. Recovery files retained from earlier attempts can be removed explicitly.

### HTTP and MCP

The existing experiments MCP endpoint exposes `list-training-workers`, `start-training-run`, `get-training-run`, `list-training-runs`, `control-training-run`, `list-model-versions`, `prepare-model-upload`, `register-model-upload`, and `use-model-version`. These are the same operations exposed through `POST /api/agent/<operation>`; schema discovery remains `GET /api/agent/operations`.

`start-training-run` returns a task immediately; MCP does not execute a long GPU computation. To import local files, the CLI calls `prepare-model-upload`, PUTs raw weights to the returned upload path using its API key, then calls `register-model-upload`. An MCP client can prepare and register uploads but cannot read a user's local filesystem on its own. Weight transfers use HTTP, never base64 inside an MCP tool call.

### Deployment

Deploy Web and Worker together. Database initialization applies the model-registry migration automatically. It adds upload reservations and independent weight locations, and records existing versions' locations without moving or rewriting their weight bytes. Model selection and historical predictions are preserved. Workers must be upgraded because their publication payload is now a Model Bundle; their existing profiles and enrollment tokens remain valid.
