# VitroFlow

The source layout and dependency boundaries are documented in [docs/architecture.md](docs/architecture.md); server transaction and concurrency rules are in [docs/backend-architecture.md](docs/backend-architecture.md); the interface system is described in [docs/interface.md](docs/interface.md).

VitroFlow turns repeated culture images into comparable readings and reviewed detector training data. Treatments define the conditions being compared, units provide independent replicates, observations follow those units over time, and each observation names the model its images are read for and which of its classes the day counts. How an image becomes a count is defined in [docs/readings.md](docs/readings.md).

The application has two independently deployed parts:

- the Web workbench owns experiments, datasets, review state, training runs, and worker protocols;
- Workers execute published model versions and, when they carry the Ultralytics runtime, train immutable dataset snapshots and publish candidate model versions.

## Data flow

```text
Experimental design
  -> observation
  -> canonical image
  -> inference outcome
  -> reviewer correction
  -> dataset membership
  -> immutable dataset snapshot
  -> training run
  -> candidate model version
```

Postgres is the source of truth for records. One S3-compatible bucket stores immutable image and model-weight bytes referenced by those records. Storage ownership, transactions, and collection rules are documented in [Backend architecture](docs/backend-architecture.md).

## Domain rules

A Model defines the classes detected in an image, and nothing more; what an experiment computes from them belongs to the experiment. A Model exists as soon as it is named, with or without a version: its images are then read by a reviewer, and those reviews are what its first version is trained on. Its identifier is how every record names it, so two Models cannot share one, and its classes are fixed at creation because every review stored for it was drawn from them. A Model is withdrawn only while nothing names it: versions, observations, reviews, datasets, and training runs each hold it in place. The built-in `seed-detector` (seed germination) recognizes `ungerminated` and `germinated` seeds. It begins with the bundled traditional model, which finds every seed and marks it `ungerminated` for reviewers to correct; training or importing a locally trained Model Bundle registers additional versions of the same Model. Registration does not change the selected version or repeat training; CLI, HTTP and MCP share the training and model operations documented in [vitroctl](docs/vitroctl.md#training-and-model-delivery).

A Model's current version is the one a person chose to read its images, and only a person changes it. Training publishes a candidate, which reads nothing for experiments: it is compared with the current version on the validation images its snapshot held out, reviewed images it never trained on, by how far each counts from the reviewer per class and in all, scored only over the images both have read. Choosing a version makes every observation of the Model read anew by it; choosing the previous one back restores its detections at once, because detections are kept per image and version. Reviews and agent proposals are kept per image and Model, so neither choice changes them. The built-in Model starts with its traditional version current, and a Model of one's own has no current version until a person chooses one.

An Experiment's name is unique across the workbench, compared without regard to case. It records the plant material, explant type, shared base medium, notebook notes, and inoculation date.

A Treatment names one condition the experiment compares. It may record that condition as a factor, level, and unit, written as applied; a treatment described in prose alone has no factor. Light, temperature, and other protocol that every treatment shares belong on the experiment. The factor and note can be filled in at any point.

A Unit is one independent experimental unit, the vessel a treatment is applied to, and exists before any image does. Every unit replicates exactly one treatment: an experiment is created with its design, at least one treatment laid out in replicates coded `T1-1` through `T1-n`, and a treatment can gain replicates later. Its code is unique within the experiment. Correcting a code, or moving a unit to the treatment it actually received, preserves the unit identity and every record attached to it. Objects within a unit are measured in each observation image.

An Observation is one day the units were photographed, and it names the Model those images are read for and which of that model's classes the day counts: a germination trial counts every seed on its first day and only the germinated ones after. The version that reads for a model is its current one, so a model with none leaves its images for a reviewer and choosing another reads them all afresh. The grid names the model in the column header when the days do not all read for the same one, and the classes a day counts when they are fewer than its model recognizes, so values in one column are comparable while columns may read different things. A new observation starts from what the previous one read. Changing an observation's model loses nothing: detections are kept per image and version, and reviews per image and model. Changing the classes it counts recounts the readings already made. An observation is recorded together with the photographs taken that day, each matched to its unit, and photographs can be added to a recorded day later; a day may also be recorded before any image exists. Treatments, units, protocol fields, and observation dates stay correctable so a miswritten label can be fixed. A unit with images or culture events cannot be deleted, because those records belong to the physical unit; a treatment is deleted with its units, so one whose units have records cannot be deleted either. The design never empties: an experiment keeps at least one treatment, and a treatment keeps at least one replicate, so the last of either can be neither deleted nor moved away. An inoculation date cannot move past an existing observation. An observation with an image or culture event cannot be deleted. An experiment with images or culture events cannot be hard-deleted.

A CultureEvent records contamination, nonviability, discard, harvest, or a missing unit against the observation where it was identified. Discarded, harvested, and missing are terminal events: the unit is absent from every later observation and analysis denominator, and a unit has at most one. Whether an event excludes the unit from analysis follows from its type: contaminated, discarded, and missing do, while a nonviable unit is a result rather than a loss and a harvested unit was measured. An event recorded by mistake is removed. Each unit is a row beside its treatment. A unit's cell shows its count, provisional until a person has reviewed it; a photograph not yet counted shows as a photograph, a unit not photographed shows no value, and only a failed count is marked.

A photograph a person cannot read clearly, such as a fogged lid or a dish out of focus, is marked unclear (不清晰). The mark belongs to the canonical image, not to the experiment, unit, observation, or model that shows it, and a photograph without one is clear. Whether unclear photographs count is each experiment's setting, off unless someone turns it on. Where they do not count, an unclear photograph takes its whole unit out of the analysis, every day of it, since the mark says the dish's record cannot be trusted: the grid still shows the unit's numbers, struck through, and the spreadsheet writes the word for unclear in their place. A day an event takes out is named by the event, and a photograph on such a day takes nothing else out. A day with no photograph is not an exclusion; the unit only has no number that day. Where they count, the number is used as it stands. Either way the photograph stays visible, is still read and carries the mark, and datasets train on it like any other. Marking, clearing, or changing the setting recomputes nothing; it only changes what counts.

An Observation is one occasion, named by the day it happened. It cannot precede inoculation. An experiment is observed once a day at most, and observations are ordered by that day.

Observation images are assigned to the units they show, one per unit per observation. A source filename is retained for traceability but is not an identifier; it provides an initial code suggestion that the operator confirms. A cell that already has an image can be given a different one. An assignment can be removed without changing the canonical image, its inference outcome, or its annotation.

An uploaded JPEG, PNG, or TIFF is normalized to an oriented, opaque sRGB AVIF. Those bytes determine the image digest, dimensions, browser view, inference input, and training input.

`inference_outcomes` stores one immutable successful detection per image and ModelVersion, including the valid zero-box case. `inference_tasks` owns completion and retry state; `inference_attempts` retains execution ownership, deadlines and failures. Execution errors never become detection results.

An annotation belongs to an image and Model, independent of the experiment or dataset from which it was opened and of any inference outcome. A review begins from what one ModelVersion found and is independent of that detection from then on: detections are recomputed by every version, while the annotation changes only when a person stores another review. The reviewer edits a local draft and confirms it once. Submission freezes the draft; the save compares its original stored boxes with the current review in the same transaction. A conflict keeps the draft without overwriting another review. This baseline belongs to the save request, not to the transferable annotation document; an image is reviewed once an annotation is stored for it, and only reviewed images enter dataset snapshots and YOLO exports. An image that should not train is removed from the dataset.

A Dataset travels as a manifest and the canonical images it names. The manifest carries the memberships, the annotations for the dataset's Model, and which of its photographs are unclear; another workbench imports it whole, provided it knows the Model with the same classes, holds every image, and has no dataset of that name and no annotation of those images for that Model. An import adds unclear marks and never clears one. Detections in a manifest are informational and never imported.

## Scope

The current workbench covers one standardized image per unit and observation, read for one model. A reading counts every instance found, whatever class it carries. Objects detected within a unit are subsamples, not independent biological replicates. A physical Petri-dish boundary remains an image-analysis diagnostic rather than the identity of the experimental unit.

## Source development

Requirements are Python 3.11+, [uv](https://docs.astral.sh/uv/), Bun 1.4.0, and Docker for the local Postgres and S3-compatible services.

Install locked dependencies and start storage:

```bash
uv sync --all-extras --group dev --locked
cd web && bun install --frozen-lockfile && cd ..

cp web/.env.example web/.env
docker compose up -d postgres rustfs
docker compose run --rm bucket
```

Set `BETTER_AUTH_SECRET` in `web/.env` to a random value of at least 32 bytes (`openssl rand -base64 32`), then set the initial administrator email and password.

Start the workbench:

```bash
cd web
bun run dev
```

The workbench initializes the database from `web/drizzle/0000_init.sql` when it starts. During development, schema changes regenerate this single initial schema and its snapshot; the repository does not carry incremental migrations. Align an existing database separately before using a changed baseline; preserve its data and frozen task plans. Startup does not upgrade an initialized database by reapplying the baseline. Its default source-development configuration connects to Postgres and RustFS on localhost and signs in with the administrator account from `web/.env`.

## Accounts

Everyone signs in with an email address and password; there is no self-service sign-up. Accounts hold one of two roles: administrators maintain the account directory under **Users**, and members use the workbench. Every user changes their own password under **Account**; administrators reset passwords for other accounts under **Users**. Suspending an account ends its sessions and refuses sign-in until it is reinstated; deleting one removes the account and its sessions and leaves experiment records untouched.

A deployment whose directory is empty creates its first administrator from `VITROFLOW_ADMIN_EMAIL` and `VITROFLOW_ADMIN_PASSWORD` when it starts. Once any account exists those variables are inert. `BETTER_AUTH_SECRET` signs session cookies, and `BETTER_AUTH_URL` is the public workbench origin that browser requests must match.

Authentication is [Better Auth](https://better-auth.com) over the application database, served at `/api/auth/*`. Programmatic access belongs to accounts too: under **Integrations** every account issues personal API keys for experiment records, image annotation and dataset transfer and reviews the MCP clients it has authorized. Workers are machines, not accounts: an administrator enrolls each one on the **Workers** settings page and it presents its own token.

## Workers

Workers communicate only with the workbench HTTP API. An administrator enrolls each machine under a name on the **Workers** settings page, which shows its token once; the token is the worker's identity on every request, and removing the worker revokes it and returns its work to the queue. Each native Worker profile holds that token, a fresh process-session ID, and a private work directory; every session heartbeats the runtimes it executes and the memory its accelerator offers, and what it is doing follows from the lease it holds. A Worker serves both queues: one that can train takes a queued training run before an inference pair, and one without the Ultralytics runtime only detects.

The operator package is published on PyPI as [`vitroctl`](https://pypi.org/project/vitroctl/); its own README is [docs/vitroctl.md](docs/vitroctl.md). On macOS, install it and configure `launchd` services:

```bash
uv tool install 'vitroctl[yolo]'

vitroctl worker setup mac-studio \
  --server http://localhost:3000 \
  --device mps
```

Setup asks for the token the Workers page showed, then validates it, the runtime imports, and the selected device before saving the profile. The token is prompted without echo and stored in `~/.vitroflow/profiles/<profile>/config.toml` with mode `0600`; LaunchAgent files contain no credentials.

Operational commands are:

```bash
vitroctl worker list
vitroctl worker status mac-studio
vitroctl worker doctor mac-studio
vitroctl worker logs mac-studio --follow
vitroctl worker restart mac-studio
vitroctl worker stop mac-studio
```

`launchd` restarts a Worker that crashes. A Worker whose machine is removed from the Workers page stops and stays stopped, and `worker list` shows why; enroll the machine again and rerun `setup --force` with the new token.

Workers advertise the traditional runtime and, when installed and importable, the pinned Ultralytics runtime. Each Worker has one inference execution slot. The server assigns an image/version task with an attempt number, a 90-second renewable lease and a fixed execution deadline. Repeated claims return the same active attempt; waiting images remain available to other Workers. A warm supervised child process loads models, downloads canonical images and predicts. Losing ownership, exceeding a deadline or stopping the Worker terminates that process, including blocked native calls.

The server accepts results only from the current live attempt and commits the result and task completion together. Replaying an acknowledged result returns success even when its response was lost; a superseded attempt cannot overwrite it. Transient failures retry up to three attempts with backoff, while a failed Worker cools for 60 seconds so another can take over. Terminal failures are visible in image reviews and model comparisons; explicit retry preserves attempt history and starts a fresh budget. Inference reconciliation runs every 10 seconds in maintenance and also during claims, so lease recovery does not depend on maintenance being online.

A Worker keeps the canonical images it has read in its work directory, by digest, for inference and training alike: a new version reads the images an earlier one read without fetching them again, and a training run links its dataset to those files instead of copying them. Images an assignment or run is using stay; past a 20 GiB budget the least recently used of the rest are forgotten.

For training they claim a queued run, fetch the snapshot images they do not hold, several at a time, materialize the canonical YOLO dataset, and advance through `preparing`, `training`, and `validating`. Every claim is fenced by worker ID, session ID, lease, and attempt. Completed epochs report losses, precision, recall, mAP50, mAP50-95, fitness, and learning rate. Publication registers verified `best.pt` bytes and their inference manifest as one candidate ModelVersion.

## Preparing photographs

Experimenters photograph each dish, often several times in a row, and copy the photographs into a folder. The [`vitroflow`](packages/vitroflow/README.md) command, published on PyPI, sorts that folder into dishes, suggests the photograph whose seeds are sharpest for each and says whether its seeds can be counted, without reading labels or touching the files. A person confirms the suggestions on a page the command serves on their machine:

```bash
uvx vitroflow photos sort ~/plates -o ~/plates/plates.json
uvx vitroflow photos review ~/plates/plates.json
```

## Agent interface

AI agents maintain experiment records over the same domain layer the workbench uses, acting as the account that let them in. Every request is authorized afresh by its API key or MCP client; each command runs in one transaction that a failure rolls back whole. Every operation validates the request schema its workbench counterpart validates, so business invariants hold regardless of which face performed the write. The interface is documented in [docs/agent-api.md](docs/agent-api.md) and has two faces over one operation registry:

- `POST /api/agent/<operation>` calls one operation with its JSON input, authenticated by a personal API key with the experiment records scope as a bearer token. `GET /api/agent/operations` describes every operation with its JSON Schema, and `POST /api/agent/images` stores image bytes and returns the digest a photograph is matched to its unit by.
- `POST /api/experiments/mcp` serves those operations as strict MCP 2026-07-28 tools. The workbench is the OAuth 2.1 authorization server for its MCP servers: a client discovers it, sends the person to sign in and approve the connection, and loses access immediately when the person disconnects it. A client configured with a request header presents the same API key instead.

Drawing boxes on images is a different job with its own MCP server, `POST /api/annotation/mcp`, described in [AI annotation](docs/ai-annotation.md). An agent is configured with the server its job needs, and each is authorized on its own:

```bash
claude mcp add --transport http vitroflow-experiments https://<workbench>/api/experiments/mcp
claude mcp add --transport http vitroflow-annotation https://<workbench>/api/annotation/mcp
```

## Experiment export

**Export spreadsheet** on the experiment page downloads the grid as one `.xlsx`
sheet. Its rows, quantities, missing values, and culture-event semantics follow
the rules in [Readings](docs/readings.md).

## Dataset transfer

A Dataset leaves a workbench as an archive: **Download** on the dataset page streams a ZIP holding the dataset's manifest and every image it names, stored uncompressed under the same layout as a local data root. **Import** on the model's page reads such an archive in the browser, stores each image under its digest, and then applies the manifest, so a dataset moves between workbenches with its annotations intact and nothing is re-encoded on the way.

Wire documents shared by the Web control plane and Python workers/CLI are defined by the Web Zod schemas. `bun run contracts:generate` emits their JSON Schemas into `vitroctl`; `make check` refuses stale generated contracts. Python validates shared structure against those schemas before decoding domain objects and enforcing cross-field semantics.

The same transfer runs from the command line over `/api/transfer/`, opened by a personal API key that holds the transfer scope:

```bash
export VITROFLOW_SERVER_URL=http://localhost:3000
export VITROFLOW_API_KEY=<api-key>

uv run vitroctl dataset pull \
  --dataset fixtures \
  --data-root data

uv run vitroctl dataset push \
  --dataset fixtures \
  --data-root data
```

The local layout shares content-addressed blobs across datasets, and an unpacked archive is a data root for one dataset:

```text
data/
├── blobs/<xx>/<sha256>
└── datasets/<dataset>.json
```

Every command verifies blob digests before reading them. `push` sends a dataset to a workbench that does not have it yet and sends nothing otherwise.

A transferable manifest contains at most 10,000 images and 16 MiB of JSON; each canonical image is at most 64 MiB. These bounds keep validation and the final database transaction finite without constraining ordinary experimental datasets.

## Local dataset workflows

Run the bundled traditional detector over a pulled dataset:

```bash
uv run vitroctl recognize \
  --dataset fixtures \
  --data-root data \
  --output output/recognition
```

Evaluate or train its candidate scorer from reviewed annotations:

```bash
uv run vitroctl traditional evaluate \
  --dataset fixtures \
  --data-root data

uv run vitroctl traditional train \
  --dataset fixtures \
  --data-root data \
  --output output/models/traditional-candidate
```

Export the reviewed annotations as a deterministic YOLO dataset:

```bash
uv run vitroctl dataset export-yolo \
  --dataset fixtures \
  --data-root data \
  --output output/datasets/fixtures-yolo \
  --validation-fraction 0.2 \
  --seed 42
```

Train with the same pinned recipe and adapter a Worker uses, then register the exact result:

```bash
uv run vitroctl training run --local --spec training.json \
  --data-root data --output output/models/yolo-candidate --device mps
uv run vitroctl models import output/models/yolo-candidate/bundle --model <model-id>
```

Training presets pin the base-weight SHA256, Ultralytics version, and training parameters. The Web dialog selects a preset and accepts parameter adjustments; the server validates and freezes the resolved recipe in the run. Resuming uses the run's recipe and checkpoint arguments.

- `configs/yolo26/yolo26n-whole-v1.recipe.json` (default): YOLO26n, image size 1536, batch 4, nominal batch size 64, 50 epochs, patience 20, warmup 3.
- `configs/yolo26/yolo26s-whole-2048-v1.recipe.json`: YOLO26s, image size 2048, batch 1, nominal batch size 8, 50 epochs, no warmup or early stopping.

Both presets use AdamW with learning rate 0.001 and disable Mosaic, MixUp, and Copy-Paste. Other augmentation settings come from the pinned runtime. For local training, put the selected recipe and any deliberate parameter overrides in `training.json`. Epochs defines the learning-rate schedule; pausing a run does not shorten that schedule.

Validation uses at most the actual per-device training batch, including after automatic batch reduction. The best checkpoint is calibrated with best-F1 confidence. `execution.json` records actual framework arguments, batch sizes, and gradient accumulation. Workers preserve these diagnostics in their profile log before removing the attempt directory.

Preset IDs and filenames include a version. Change a preset by adding a new version, keeping the previous manifest unchanged. Parameter contracts are generated from the Web Zod schemas with `cd web && bun run contracts:generate`; `bun run contracts:check` verifies they are current. Worker update requirements are documented in [the operator guide](docs/vitroctl.md#workers).

`training.json` contains `dataset` (the pulled dataset name) and `recipe` (the recipe object in `configs/yolo26/yolo26n-whole-v1.recipe.json`, with any deliberate overrides). The saved specification fixes the base-weight digest, Ultralytics version, and training arguments. See [training and model delivery](docs/vitroctl.md#training-and-model-delivery) for managed training, resume, existing-weight packaging, MCP, and explicit version selection.

## Publishing the Python packages

`vitroctl` is versioned in the root `pyproject.toml` and `vitroflow` in `packages/vitroflow/pyproject.toml`; each is released on its own. Set the package's new version, then build and upload it from a clean `dist/`:

```bash
rm -rf dist
uv build --package vitroflow
uv publish
```

`uv publish` reads the PyPI token from `UV_PUBLISH_TOKEN`. Tag the published commit with the same version.

## Deployment

Create the Compose environment and replace every credential before starting the deployment:

```bash
cp .env.example .env
docker compose up --build -d
```

Compose runs the workbench, maintenance process, Postgres 18.6, RustFS, and the one-shot bucket initializer. It exposes the workbench on port 3000 and RustFS on ports 9000 and 9001. Services restart unless stopped. Maintenance collects unreferenced blobs and automatically refreshes missing or obsolete dish analysis in small serial batches; see [Images](docs/images.md) for retry and resource budgets.

`BETTER_AUTH_SECRET` is a random value of at least 32 bytes, such as `openssl rand -base64 32`. `BETTER_AUTH_URL` is the origin browsers and MCP clients reach the workbench at; it is the OAuth issuer and the MCP endpoint is bound to it, so it must be `https://` anywhere but localhost.

`zeabur-template.yaml` deploys workbench and maintenance from the same repository and `Dockerfile.web`, plus marketplace PostgreSQL and MinIO. Maintenance runs `bun dist/maintenance.js`, shares the storage environment, and has no public port. Deploy both application roles from the same commit; image-based deployments pin the same image digest. Workers stay outside the platform. MinIO creates its bucket from its own start command.

The root `.env.example` defines only Compose inputs and immutable container manifests. `web/.env.example` defines the workbench environment for source development. Registry mirrors can replace the three image values without changing the Compose file.

## Verification

Run the complete deterministic gate from the repository root:

```bash
make check
```

It runs `make check-python` (the architecture check, Ruff lint and format check, Pyright and pytest) and `make check-web` (the production build, the architecture, contract and Prettier checks, Biome lint, TypeScript and the Web tests).

Build the pinned production image:

```bash
make check-image
```

The reference-image regression suite uses the checksum manifest in `tests/fixtures/reference-images.json`. Point it at the matching private corpus:

```bash
make check-reference REFERENCE_IMAGE_DIR=/absolute/path/to/reference-images
```

Run the constraints and contended writes that need a real PostgreSQL server:

```bash
export VITROFLOW_TEST_DATABASE_URL=postgres://vitroflow:vitroflow@localhost:5432/vitroflow_test

make check-postgres
```

Run the BlobStore contract against an actual S3-compatible endpoint:

```bash
export AWS_ACCESS_KEY_ID=vitroflow
export AWS_SECRET_ACCESS_KEY=vitroflow
export AWS_REGION=us-east-1
export VITROFLOW_TEST_S3_ENDPOINT=http://localhost:9000
export VITROFLOW_TEST_S3_BUCKET=vitroflow

make check-s3
```

`make check` is the local verification gate. The production image, real PostgreSQL invariants, and S3 contract are separate gates: run `make check-image`, `make check-postgres`, and `make check-s3` with their documented environment variables. The default suite runs on PGlite, one connection and no external services, so the S3 contract and anything needing two sessions at once wait for their own gate. The reference-image gate is reproducible from its digest manifest and runs wherever the private corpus is provisioned.

VitroFlow is licensed under the [MIT License](LICENSE).
