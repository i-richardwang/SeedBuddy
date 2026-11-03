# vitroctl

Operator CLI and native Worker runtime for a [VitroFlow](../README.md) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Workers that detect and train for it and moves datasets between a workbench and a local data root.

Worker services run under `launchd` and therefore require macOS. The `dataset`, `recognize`, `traditional`, `training`, and `models` commands run wherever Python 3.11+ is available.

## Install

Install `vitroctl` from source.

```bash
git clone https://github.com/i-richardwang/VitroFlow.git
cd VitroFlow
uv tool install --from '.[yolo]' vitroctl
```

The `yolo` extra installs the pinned Ultralytics runtime that Workers advertise. Without it, a Worker serves the bundled traditional detector and takes no training runs.

## Workers

An administrator enrolls each Worker on the workbench's Workers page, which shows its token and setup command once. Each Worker profile holds that token and a private work directory; [Worker identity](backend-architecture.md#worker-control-planes) defines its authentication. Setup validates the token, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
vitroctl worker setup mac-studio \
  --server https://<workbench> \
  --device mps \
  --poll-seconds 5
```

`--poll-seconds` sets the interval between work polls.

The token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
vitroctl worker list
vitroctl worker status mac-studio
vitroctl worker doctor mac-studio
vitroctl worker logs mac-studio --follow
vitroctl worker start mac-studio
vitroctl worker restart mac-studio
vitroctl worker stop mac-studio
```

`launchd` restarts a Worker process that crashes. Removing its Worker from the Workers page stops the process and keeps it stopped, and `worker list` shows why; enroll it again and rerun `setup --force` with the enrollment token.

`vitroctl worker start <profile>` loads the installed LaunchAgent. `stop` and `restart` return once the Worker process has exited; `restart` then loads the current LaunchAgent definition. Training runs in a child process. On cancellation, shutdown or lease loss, the Worker process supervisor terminates the child’s process group, including data-loader children, even during a blocked GPU operation. The server revokes ownership immediately; the Worker process detects revocation on its next training request or lease renewal. Each attempt uses a private directory. Completed but undelivered bundles are retained; other attempt directories are removed when execution exits.

Inference execution and retry policy are described in the [Worker control planes](backend-architecture.md#worker-control-planes). Worker processes make outbound calls only and expose no inbound port. Web and Workers share wire contracts with no mixed-version protocol: stop Workers, deploy Web, install the matching Worker package, then start Workers with `vitroctl worker restart <profile>`.

Training presets pin model weights, parameters, and the framework version. The Web dialog accepts parameter adjustments, and the server validates and freezes the resolved recipe in the run; resuming does not consult the preset registry.

Worker processes validate both training recipes and the training metadata in published model manifests. A framework version match alone does not establish application-contract compatibility; both sides validate the shared contracts.

The training dialog assigns work automatically or to a specific enrolled Worker. The [training-run status menu](interface.md#pages) exposes run controls. Pause revokes the current attempt and releases the model immediately; cancellation ends the task. A paused or failed task continues once no other run of its model is in progress, on the training Worker its dialog names, from its saved epoch or with a fresh attempt. A pinned task waits for its selected Worker rather than silently moving elsewhere.

Each epoch saves the latest resumable weights, best weights, and epoch journal on the Worker. Only metrics and the local recovery location are reported to the workbench; checkpoint bytes stay on the Worker during training. A run becomes bound to its Worker when first claimed. Pause or contact loss retains its local state, and resume uses that same Worker. Missing or invalid files fail with an explicit restart instruction; host or disk loss is not recoverable from the workbench.

Local recovery checks the run, frozen dataset snapshot, recipe, and Worker identity before atomically copying each recovery directory into the next attempt. The trainer verifies the checkpoint and epoch journal before resuming. Attempts with local weights or a finished bundle are excluded from automatic stale-run cleanup; their log identifies the retained directory. Remove retained directories explicitly when unneeded.

Only the final model is uploaded. `PUT /api/worker/training/runs/:runId/artifact-parts` transfers sequential weight parts of at most 8 MiB, with a total limit of 512 MiB. `POST /api/worker/training/runs/:runId/artifact` submits the model manifest and publishes the verified weights. Part size and SHA-256, complete-file identity, recipe, and attempt ownership are checked before publication. Part retries and publication retries are idempotent. Maintenance removes parts after publication or after the attempt ends or expires. A failed delivery retains the finished bundle; retrying on the same Worker publishes it without training again.

Completed epochs report losses, precision, recall, mAP50, mAP50-95, fitness and learning rate. Execution advances through `preparing`, `training` and `validating`.

The run page lists execution attempts and the last reported local checkpoint epoch. Lease renewal does not count as training progress. If a Worker loses contact, its run waits for that Worker; an operator can pause it and explicitly restart elsewhere. A held run without progress for 15 minutes shows a warning. Every execution request carries its session and attempt, so cancelled or superseded attempts cannot report progress or publish models.

`vitroctl worker run <profile>` runs a Worker process in the foreground without `launchd`.

A Worker process keeps the canonical images it has read in its work directory, by digest, for inference and training alike: another version reads the images an earlier one read without fetching them again, and a training run downloads missing snapshot images concurrently and links its dataset to the cached files. Images an assignment or run is using stay; past a 20 GiB budget the least recently used of the rest are forgotten.

## Datasets

Dataset transfer uses `/api/transfer/` with a personal API key that holds the Dataset transfer scope:

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

Every command verifies blob digests before reading them. `push` sends a dataset only when the destination has no dataset of that name. Dataset archive rules are in [Records, models and datasets](domain.md#dataset-transfer).

Annotations export as a deterministic YOLO dataset. `DatasetSplitError` reports an export that cannot form training and validation splits:


```bash
vitroctl dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

## Local detection and traditional training

Run the bundled traditional detector over a pulled dataset:

```bash
vitroctl recognize \
  --dataset fixtures \
  --data-root data \
  --output output/recognition
```

Evaluate or train its candidate scorer from reviewed annotations:

```bash
vitroctl traditional evaluate \
  --dataset fixtures \
  --data-root data

vitroctl traditional train \
  --dataset fixtures \
  --data-root data \
  --output output/models/traditional-candidate
```

## Training and model delivery

Training and model registration are independent. A Worker process and local training produce the same Model Bundle: `bundle.json` and `weights.pt`. The manifest fixes ordered classes, weight digest and size, inference settings, the training recipe, runtime requirements, dataset provenance, and evaluation/calibration evidence. Checkpoints remain separate and are only needed to continue training.

Example input and output paths below are operator-selected files, not bundled fixtures. A training specification is JSON with `dataset` and `recipe`. `recipe` has the same structure as the bare recipe document in `configs/yolo26/yolo26n-whole-v1.recipe.json`: pinned base-model reference and digest, training parameters, and framework version. Optional `nbs`, scale, rotation, flip, translation and HSV parameters override the pinned framework's defaults. The resolved scalar trainer arguments and a training-code fingerprint are saved in `training-context.json` and included in generated bundles.

- `configs/yolo26/yolo26n-whole-v1.recipe.json` (default): YOLO26n, image size 1536, batch 4, nominal batch size 64, 50 epochs, patience 20, warmup 3.
- `configs/yolo26/yolo26s-whole-2048-v1.recipe.json`: YOLO26s, image size 2048, batch 1, nominal batch size 8, 50 epochs, no warmup or early stopping.

Both presets use AdamW with learning rate 0.001 and disable Mosaic, MixUp, and Copy-Paste. Other augmentation settings come from the pinned runtime. For local training, put the selected recipe and any deliberate parameter overrides in `training.json`. Epochs defines the learning-rate schedule; pausing a run does not shorten that schedule.

Validation uses at most the actual per-device training batch, including after automatic batch reduction. The best checkpoint is calibrated with best-F1 confidence. `execution.json` records actual framework arguments, batch sizes, and gradient accumulation. Worker processes preserve these diagnostics in their profile log before removing the attempt directory.

Preset manifests are immutable and their filenames identify their versions.

For local training, `dataset` is the name of a pulled dataset. For managed training, it is the workbench dataset ID returned by `list-datasets`.

```bash
# Local compute; no server or Worker registration required.
vitroctl training run --local --spec training.json --data-root data \
  --device mps --output output/my-training

# Continue an interrupted local run with exactly the same inputs.
vitroctl training run --local --resume --spec training.json --data-root data \
  --device mps --output output/my-training

# Workbench operations require an API key with the Experiment records scope.
vitroctl training workers
vitroctl training run --spec managed-training.json --worker mac-studio
vitroctl training list --model seed-detector
vitroctl training get <run-id>
vitroctl training pause <run-id> --dataset <dataset-id> --attempt 1
vitroctl training resume <run-id> --dataset <dataset-id> --attempt 1 --restart --worker another-worker
vitroctl training cancel <run-id> --dataset <dataset-id> --attempt 2
```

`training resume --restart` discards the recovery reference and starts training afresh, allowing another Worker to claim the run. Without it, resume uses the bound Worker and its recovery files.

Local outputs retain the fixed input manifest, exported data and split membership, checkpoints, epoch journal, inference summary, and `bundle/`. Resume requires the saved `input.json` to exactly match the canonical JSON identity built from the spec and manifest, including their camelCase wire keys, before using a checkpoint; changing data or parameters requires another output directory. A completed training cannot be resumed from a stripped final checkpoint. Its bundle can still be imported repeatedly without training.

```bash
# Register the bundle.
vitroctl models import output/my-training/bundle --model seed-detector
vitroctl models list --model seed-detector

# Select the returned version ID explicitly. Selecting any registered ID uses that version.
vitroctl models use --model seed-detector --version <version-id>
```

For experimental weights, prepare a manifest matching [the bundle contract](../src/vitroctl/contracts/model-bundle.schema.json). The `weights` descriptor can be omitted from the input metadata; `pack` computes it. Include the actual class order, chosen confidence and image size, original recipe, selected epoch if known, data fingerprint if available, and the separate calibration/evaluation descriptions. Unknown provenance is explicitly `null`; do not invent a snapshot or report full-dataset training for a subset experiment.

```bash
vitroctl models pack --weights output/experiment/weights/last.pt \
  --metadata experiment-bundle.json --output output/candidate
vitroctl models import output/candidate --model seed-detector
```

Packaging and CLI import load the weights on CPU to verify their ordered classes and require the declared Ultralytics version. The supported delivery pipeline is `mode: "whole_image"` with explicit `iou: 0.7`, recorded from `YOLO_IOU` in `contracts/inference.py`. Tiling or another IoU is rejected. Such pipelines require an adapter and contract extension before they can be registered. Registration validates metadata and byte identity; a reported accuracy metric is provenance, not a platform-certified score. Version selection follows the [model lifecycle](domain.md#models-and-versions).

The workbench uses content-derived upload identities and version identities covering the entire bundle and its origin. Repeating import safely returns the same version; changing inference settings creates another version even with identical weights. Upload reservations expire after 24 hours unless registered, and preparing the same bundle renews the reservation. Upload and registration are separate so connection failures can be retried. Delivered versions retain their immutable bytes independently of their training run.

The CLI can import a retained Worker bundle to recover completed work after failed publication. A successful publication removes the current local attempt directory. Recovery files retained from earlier attempts can be removed explicitly.

### HTTP and MCP

The [Agent API](agent-api.md#training-and-model-delivery) exposes training and model delivery through HTTP and MCP.

`start-training-run` returns a task immediately; MCP does not execute a long GPU computation. To import local files, the CLI calls `prepare-model-upload`, PUTs raw weights to the returned upload path using its API key, then calls `register-model-upload`. An MCP client can prepare and register uploads but cannot read a user's local filesystem on its own. Weight transfers use HTTP, never base64 inside an MCP tool call.
