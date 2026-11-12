# seedctl

Operator CLI and native Worker process runtime for a [SeedBuddy](../README.md) workbench. The workbench owns experiments, datasets, review state, and training runs; this package runs the Worker processes that detect and train for it and moves datasets between a workbench and a local data root.

Worker profile management uses `launchd` and requires macOS. The `dataset`, `recognize`, `traditional`, `training`, and `models` commands run wherever Python 3.11+ is available.

## Install

Install `seedctl` from source.

```bash
git clone https://github.com/i-richardwang/SeedBuddy.git
cd SeedBuddy
uv tool install --from '.[yolo]' seedctl
```

The `yolo` extra installs the pinned Ultralytics runtime that Worker processes advertise. Without it, a Worker process serves the bundled traditional detector and takes no training runs.

## Workers

An administrator enrolls each Worker on the workbench's Workers page, which shows its token and setup command once. Each Worker profile holds that token and a private work directory; [Worker identity](backend-architecture.md#worker-control-planes) defines its authentication. Setup validates the token, runtime imports, and the selected device before saving the profile, then installs and starts a LaunchAgent:

```bash
seedctl worker setup mac-studio \
  --server https://<workbench> \
  --device mps \
  --poll-seconds 5
```

`--poll-seconds` sets the interval between work polls.

The token is prompted without echo and stored in `~/.seedbuddy/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

```bash
seedctl worker list
seedctl worker status mac-studio
seedctl worker doctor mac-studio
seedctl worker logs mac-studio --follow
seedctl worker start mac-studio
seedctl worker restart mac-studio
seedctl worker stop mac-studio
```

`launchd` restarts a Worker process that crashes. Removing its Worker from the Workers page stops the process and keeps it stopped, and `worker list` shows why; enroll it again and rerun `setup --force` with the enrollment token.

`seedctl worker start <profile>` checks the profile, writes its LaunchAgent and loads it or asks `launchd` to start the loaded job. `stop` and `restart` return once the Worker process has exited; `restart` then loads the current LaunchAgent definition. Training runs in a child process. On cancellation, shutdown or lease loss, the Worker process supervisor terminates the child’s process group, including data-loader children, even during a blocked GPU operation. The server revokes ownership immediately; the Worker process detects revocation on its next training request or lease renewal.

Inference execution and retry policy are described in the [Worker control planes](backend-architecture.md#worker-control-planes). Worker processes make outbound calls only and expose no inbound port. The workbench and Worker processes share wire contracts with no mixed-version protocol: stop Worker processes, deploy the workbench, install the matching Worker package, then start Worker processes with `seedctl worker restart <profile>`.

Training presets pin model weights, parameters, and the framework version. The workbench dialog accepts parameter adjustments, and the server validates and freezes the resolved recipe in the run; resuming does not consult the preset registry.

Worker processes validate both training recipes and the training metadata in published model manifests. A framework version match alone does not establish application-contract compatibility; both sides validate the shared contracts.

The training dialog assigns work automatically or to a specific enrolled Worker. The [training-run status menu](interface.md#pages-and-interaction-ownership) exposes run controls. Pause revokes the current attempt and releases the model immediately; cancellation ends the task. A paused or failed task continues once no other run of its model is in progress. A task pinned before its first claim waits for its selected Worker.

Each epoch saves `weights/last.pt`, `weights/best.pt` and `epochs.jsonl` on the Worker; `detectors/ultralytics/checkpoints.py` owns this layout. Only metrics and the local recovery location are reported to the workbench; checkpoint bytes stay on the Worker during training. A run becomes bound to its Worker when first claimed. Pause or contact loss retains its local state, and resume uses that same Worker. Missing or invalid files fail with an explicit restart instruction; host or disk loss is not recoverable from the workbench.

Local recovery checks the run, frozen dataset snapshot, recipe, and Worker identity before atomically copying each recovery directory into the next attempt. The trainer verifies the checkpoint and epoch journal before resuming.

Only the final model is uploaded. `PUT /api/worker/training/runs/:runId/artifact-parts` transfers sequential weight parts of at most 8 MiB, with a total limit of 512 MiB. `POST /api/worker/training/runs/:runId/artifact` submits the model manifest and publishes the verified weights. Part size and SHA-256, complete-file identity, recipe, and attempt ownership are checked before publication. Part retries and publication retries are idempotent. Maintenance removes parts after publication or after the attempt ends or expires.

Completed epochs report losses, precision, recall, mAP50, mAP50-95, fitness and learning rate. Execution advances through `preparing`, `training` and `validating`.

The run page lists execution attempts and the last reported local checkpoint epoch. Lease renewal does not count as training progress. An operator can pause a stalled run and explicitly restart elsewhere. A held run without progress for 15 minutes shows a warning. Every execution request carries its session and attempt, so cancelled or superseded attempts cannot report progress or publish models.

`seedctl worker run <profile>` runs a Worker process in the foreground without `launchd`.

A Worker process keeps the canonical images it has read in its work directory, by digest, for inference and training alike: another version reads the images an earlier one read without fetching them again, and a training run downloads missing snapshot images concurrently and links its dataset to the cached files. Images an assignment or run is using stay; past a 20 GiB budget the least recently used of the rest are forgotten.

### Attempt storage

Each attempt uses a private directory. Local weights and completed but undelivered bundles are retained and excluded from stale-run cleanup; the log identifies their directory. Other attempt directories are removed when execution exits, including after successful publication. Retrying a retained finished bundle publishes it without training again; the CLI can also import it. Remove retained directories explicitly when unneeded.

## Datasets

Dataset transfer uses `/api/transfer/` with a personal API key that holds the Dataset transfer scope:

```bash
export SEEDBUDDY_SERVER_URL=https://<workbench>
export SEEDBUDDY_API_KEY=<api-key>

seedctl dataset pull --dataset fixtures --data-root data
seedctl dataset push --dataset fixtures --data-root data
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
seedctl dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

## Local detection and traditional training

Run the bundled traditional detector over a pulled dataset:

```bash
seedctl recognize \
  --dataset fixtures \
  --data-root data \
  --output output/recognition
```

Evaluate or train its candidate scorer from reviewed annotations:

```bash
seedctl traditional evaluate \
  --dataset fixtures \
  --data-root data

seedctl traditional train \
  --dataset fixtures \
  --data-root data \
  --output output/models/traditional-candidate
```

## Training and model delivery

Training and model registration are independent. A Worker process and local training produce the same Model Bundle: `bundle.json` and `weights.pt`. The manifest fixes ordered classes, weight digest and size, inference settings, the training recipe, runtime requirements, dataset provenance, and evaluation/calibration evidence. Checkpoints remain separate and are only needed to continue training.

Example input and output paths below are operator-selected files, not bundled fixtures. A training specification is JSON with `dataset` and `recipe`. `recipe` has the same structure as the bare recipe document in `configs/yolo26/yolo26n-whole-v1.recipe.json`: pinned base-model reference and digest, training parameters, and framework version. Optional `nbs`, scale, rotation, flip, translation and HSV parameters override the pinned framework's defaults. Bundle provenance contains the resolved scalar trainer arguments and training-code fingerprint.

- `configs/yolo26/yolo26n-whole-v1.recipe.json` (default): YOLO26n, image size 1536, batch 4, nominal batch size 64, 50 epochs, patience 20, warmup 3.
- `configs/yolo26/yolo26s-whole-2048-v1.recipe.json`: YOLO26s, image size 2048, batch 1, nominal batch size 8, 50 epochs, no warmup or early stopping.

Both presets use AdamW with learning rate 0.001 and disable Mosaic, MixUp, and Copy-Paste. Other augmentation settings come from the pinned runtime. For local training, put the selected recipe and any deliberate parameter overrides in `training.json`. Epochs defines the learning-rate schedule; pausing a run does not shorten that schedule.

Validation uses at most the actual per-device training batch, including after automatic batch reduction. The best checkpoint is calibrated with best-F1 confidence. `execution.json` records actual framework arguments, batch sizes, and gradient accumulation. Local diagnostic documents omit `schemaVersion`. Worker processes preserve these diagnostics in their profile log before removing the attempt directory.

Preset manifests are immutable and their filenames identify their versions.

### Dish framing

A snapshot of a `dish` model carries its `area` and, per image, the dish `coverage` the workbench froze when it was taken; a dataset manifest carries the same for local training. The exporter in `detectors/ultralytics/dataset.py` frames each covered image to the square around its dish, the circle's radius expanded by the coverage margin, rounded outward to whole pixels and clipped to the image. The frame is written losslessly as PNG, boxes are clipped to it and boxes wholly outside are dropped; an image without coverage is the canonical file itself, linked. The exported `manifest.json` records the `mode` and each image's `window`. `ImageCoverage` in `contracts/coverage.py` and `coverage_window` in `image_geometry/window.py` define this once for training and inference.

The bundle records the exported mode as `inference.mode` (`whole_image` or `dish`), and the workbench refuses a bundle whose mode differs from the snapshot's area. A `dish` version is handed the image's current coverage with each inference claim and reads the same frame, offsetting its boxes back into image pixels and reporting the dish under `diagnostics.dish`; without coverage it reads the whole image. A `whole_image` version is never handed coverage. The frame is recorded on the version, not hashed into its artifact digest.

For local training, `dataset` is the name of a pulled dataset. For managed training, it is the workbench dataset ID returned by `list-datasets`.

```bash
# Local compute; no server or Worker enrollment required.
seedctl training run --local --spec training.json --data-root data \
  --device mps --output output/my-training

# Continue an interrupted local run with exactly the same inputs.
seedctl training run --local --resume --spec training.json --data-root data \
  --device mps --output output/my-training

# Workbench operations require an API key with the Experiment records scope.
seedctl training workers
seedctl training run --spec managed-training.json --worker mac-studio
seedctl training list --model seed-detector
seedctl training get <run-id>
seedctl training pause <run-id> --dataset <dataset-id> --attempt 1
seedctl training resume <run-id> --dataset <dataset-id> --attempt 1 --restart --worker another-worker
seedctl training cancel <run-id> --dataset <dataset-id> --attempt 2
```

`training run --data-root` is accepted only with `--local`. `training resume --restart` discards the recovery reference and starts training afresh, allowing another Worker to claim the run. Recovery follows the [Worker binding rules](#workers).

Local outputs retain the fixed input manifest, exported data and split membership, checkpoints, epoch journal, inference summary, and `bundle/`. Resume requires the saved `input.json` to exactly match the canonical JSON identity built from the spec and manifest, including their camelCase wire keys, before using a checkpoint; changing data or parameters requires another output directory. A completed training cannot be resumed from a stripped final checkpoint. Its bundle can still be imported repeatedly without training.

```bash
# Register the bundle.
seedctl models import output/my-training/bundle --model seed-detector
seedctl models list --model seed-detector

# Select a version (see the model lifecycle linked below).
seedctl models use --model seed-detector --version <version-id>
```

For experimental weights, prepare a manifest matching [the bundle contract](../src/seedctl/contracts/model-bundle.schema.json). The `weights` descriptor can be omitted from the input metadata; `pack` computes it. Include the actual class order, chosen confidence and image size, original recipe, selected epoch if known, data fingerprint if available, and the separate calibration/evaluation descriptions. Unknown provenance is explicitly `null`; do not invent a snapshot or report full-dataset training for a subset experiment.

```bash
seedctl models pack --weights output/experiment/weights/last.pt \
  --metadata experiment-bundle.json --output output/candidate
seedctl models import output/candidate --model seed-detector
```

Packaging and CLI import load the weights on CPU to verify their ordered classes and require the declared Ultralytics version. The supported delivery pipelines are `mode: "whole_image"` and `mode: "dish"` ([dish framing](#dish-framing)) with explicit `iou: 0.7`, recorded from `YOLO_IOU` in `contracts/inference.py`. Tiling or another IoU is rejected. Such pipelines require an adapter and contract extension before they can be registered. Registration validates metadata and byte identity; a reported accuracy metric is provenance, not a platform-certified score. Version selection follows the [model lifecycle](domain.md#models-and-versions).

The workbench uses content-derived upload identities and version identities covering the entire bundle and its origin. Repeating import safely returns the same version; changing inference settings creates another version even with identical weights. Upload reservations expire after 24 hours unless registered, and preparing the same bundle renews the reservation. Weight upload and registration each support retries. Delivered versions retain their immutable bytes independently of their training run.

### HTTP and MCP

The [Agent API](agent-api.md#training-and-model-delivery) exposes training and model delivery through HTTP and MCP.

`start-training-run` returns a task immediately; MCP does not execute a long GPU computation. To import local files, the CLI calls `prepare-model-upload`, PUTs raw weights to the returned upload path using its API key, then calls `register-model-upload`. An MCP client can prepare and register uploads but cannot read a user's local filesystem on its own. Weight transfers use HTTP, never base64 inside an MCP tool call.
