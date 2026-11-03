# Backend architecture

The backend is a modular monolith. Business modules own lifecycles; protocol adapters, cross-module page queries, maintenance, and infrastructure have separate homes. It has four boundaries. Dependencies point inward; an inner layer does not describe an outer protocol.

```text
HTTP / MCP / Worker routes
            │
            ▼
application operations and Worker control planes
            │
            ▼
experiment, dataset, model, annotation, inference, and training domain services
            │
            ▼
database, immutable blob storage, and external runtimes
```

## Source boundaries

The source import rules and Vite protection are described in [Architecture](architecture.md#web-boundaries). Framework routes live in `web/src/routes/`, and Server Function adapters live in `web/src/functions/` and authorize through `web/src/functions/access.ts`. Server Function writes use create/update/remove verbs, including `updateCurrentVersion`, `updateImageAnalysis` and `updateUserStatus({ user, suspended })`.

Business modules and `queries/` expose a small `public.ts`. Cross-module callers import that entry; files inside a module import their siblings directly. Public entries export specific operations and contracts, not every internal function. Infrastructure capabilities and protocol adapters use explicit file entry points.

The allowed dependency graph lives in `web/scripts/architecture.ts`; the [architecture checker](architecture.md#web-boundaries) enforces it. Each server module has an explicit owner there.

Cross-module page queries depend on business modules; business modules never depend on those pages. For example, `queries/dataset-detail.ts` combines dataset records and training state, and datasets do not depend on training. Dataset review records remain in `datasets/` because both dataset transfer and training snapshot creation consume them. Image display names live in `queries/`: filenames belong to observation or dataset memberships, never to the global image asset.

List rows use `<Thing>Overview`, page read models use `<Thing>Detail` (for example, `UnitRowOverview` and `UnitDetail`), and readiness uses `DatasetTrainingReadiness`. These types are declared in each subject’s domain read-model module, including `web/src/domain/datasets/read-model.ts`. Query files are named after their function, such as `queries/dataset-training-readiness.ts`.

Modules use Drizzle directly. The shared foreign-key graph lives in one schema, and cross-table reads use joins. Multi-module writes share an executor and acquire locks in a consistent order. Import boundaries complement database ownership rules, constraints, and concurrency tests.

## Agent control plane

`agent/operations.ts` assembles a protocol-neutral catalog from one file per subject: `agent/experiments.ts` owns the experiment's design and records and reads the sheet (`domain/experiments/sheet.ts`), `agent/datasets.ts` the datasets, `agent/models.ts` models and model delivery, `agent/training.ts` training runs, and `agent/inference.ts` inference task control. Definitions live in `agent/definition.ts`. An entry declares a query or command, whether a command is destructive, its input/output contracts, its transaction ownership, and its handler. `agent/execution.ts` parses input, invokes the handler, validates output, and classifies failures. Commands declaring `transaction: "operation"` receive a required executor and run inside one operation transaction; their handlers must use that executor. Queries and service-owned commands have no executor parameter. Services that own their transactions declare `transaction: "service"`, so uploads and multi-stage workflows are not wrapped in an outer database transaction. Queries do not open a write transaction.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. Transaction owners enforce atomic state changes; staged model delivery uses idempotent upload reservations so an interrupted transfer can be retried.

## Worker control planes

An administrator enrolls each Worker under a name, and the token issued then is the Worker's identity: the workbench keeps only its hash, resolves every Worker request to its Worker from the token, and never reads a Worker ID from a request. Removing the Worker revokes the token and ends its session. A fresh session ID fences one process incarnation from another. `workers` holds the enrolled Workers; `worker_sessions` holds each one's current session: the runtimes it executes, the memory it offers, and when it was last heard from. Presence is the heartbeat age; what a Worker is doing is the lease it holds, never a second copy in the roster.

Inference separates durable work, execution attempts and successful results. `inference/demand.ts` materializes experiment and validation demand into unique image/version tasks without requiring an available Worker. `inference_tasks` retains queued, running, succeeded or terminally failed state. `inference_attempts` retains every execution identity, Worker/session, start, immutable deadline, lease, completion receipt and failure. Removing a Worker retains this history. `inference_outcomes` stores one immutable successful detection per image and version, including zero-box results.

`inference/attempts.ts` atomically leases at most one inference task per Worker. Repeating a claim returns the live attempt without extending its deadline. Both training and inference claims lock the Worker session and refuse to allocate while the other queue holds the accelerator. Inference renewals and submissions also lock the session, then the task; result storage acquires the detection lock last. Each owned operation checks the attempt number in addition to Worker/session. Database uniqueness constraints enforce one running attempt per task and per Worker.

Each lease operation samples the database wall clock once after acquiring its ownership lock and reuses that timestamp for ownership predicates, update fences and lease expiry. Renewal is capped by the fixed deadline; a heartbeat is presence, never evidence of execution progress. `inference/tasks.ts` owns expiry, retry and inspection. Reclamation locks tasks with `SKIP LOCKED` and re-reads attempts after locking, so a concurrent renewal is not mistaken for expiry. [Maintenance](images.md#maintenance) and claims use the same expiry transition. Claim-time reconciliation commits before locking the Worker slot, keeping cross-task recovery locks out of the allocation transaction. A task executes at most three attempts, with 5/10-second retry delays; a failed Worker has a 60-second cooldown derived from its attempt history, independent of session restarts. Other Workers can take over after the retry delay. An explicit retry resets only the retry budget, not the monotonic attempt number or history.

Successful result storage, task completion and the attempt's canonical result digest commit in one transaction. Identical completed submissions replay that receipt; an expired, superseded or differently submitted attempt is rejected. An attempt failure is reported separately and never fabricated as a detection. Image reviews and model comparisons show terminal failures; the experiment MCP/HTTP operations expose task history and explicit retry. Once materialized, a task remains durable even if its model is not selected; successful results remain reusable if that version is selected again.

A Worker process supervises a warm child process that owns downloads, model loading and prediction. Supervision uses a monotonic clock derived from server durations, bounded HTTP exchanges and interruptible IPC. The process is terminated on lost ownership, timeout, error, shutdown or before training. Inference deadlines are 10 minutes for the traditional detector and `min(30 minutes, 10 minutes + 2 minutes × ceil((imageSize / 1024)²))` for Ultralytics, covering cold loading and transfer. Leases are 90 seconds and renew every 20 seconds. These budgets are execution policy, not model identity. Tasks wait explicitly when no capable Worker exists; there is no overall queue-wait deadline.

`inference/attempts.ts` owns claim and execution orchestration and calls `inference/outcomes.ts` with the same executor when completing a task. Result validation never depends on the task orchestrator. `models/publication.ts` owns portable model bundles, upload reservations, immutable version registration, weight delivery and collection. Training publication validates execution ownership and delegates registration within its short completion transaction. An external import uses the same registry without creating a training run.

Production inference results enter through attempt completion. Tests seed detections or terminal task failures through `testing/inference.ts`; this fixture is outside the production module graph. Collection and outcome tests live alongside the image and inference modules that own those rules.

Inference and training share the roster and its ownership vocabulary—Worker, session, lease, and attempt—but each keeps its own state machine. Claims lock the Worker row, and every owned write carries the predicate that the session is still the roster's. A lease holds while it is unexpired and its session is still current, so a restarted or removed Worker loses ownership without waiting for its lease to expire; inference then applies its bounded retry policy. Removing a Worker returns its work to the queue under each queue's recovery rules. A Worker process serves both queues, prioritizing training over inference, according to its advertised capabilities. The process owns the accelerator lifecycle: it releases the cached inference model before training and collects runtime allocations when training exits. Consecutive inference tasks may reuse the cached model.

## Annotation execution and readings

`annotation-runs/runs.ts` reads and validates the current image, model, input readings and stored dish analysis under one image lock, then inserts the frozen definition and task plan in the same transaction; the image's active run is unique, so concurrent starts cannot create two. `tasks.ts` finds the next region of the image's run in progress and owns regional previews and acceptance, `access.ts` resolves a task identifier to its region and run, locking both only to accept the region, and pure domain operations validate geometry and collect final results. `views.ts` reads shared context and regional evidence through images; rendering formats a stable run context separately from regional CLEAN and overlays; MCP content encoding belongs to `transport/mcp`. `queries/pending-annotations-detail.ts` implements `pendingAnnotationsDetail`, which lists the dataset and observation images with a run in progress, and supplies the annotation server’s [pending work](ai-annotation.md#tool-contract).

The `readings` module owns the image's combined reading: stored human annotation, latest successful AI proposal, detection and the progress of a run in progress. Starting a run, MCP and workbench pages use that same read model. A page review adds the filename known by that page. `annotations` owns the human-reviewed document, and `annotation-runs` owns execution and acceptance. `readings/images.ts` owns a lateral subquery that pages left-join. Its version is an explicit parameter; the [reading rules](readings.md#where-the-numbers-come-from) distinguish grid counts from workbench display.

## Training execution

`training/epochs.ts` owns epoch persistence. `training/runs.ts` owns run state transitions; owned phase and epoch updates share `fencedUpdate`, which checks the Worker, session, attempt and live lease in the update predicate; lease renewal uses the same fence without changing business progress. `requireTrainingRun` distinguishes a missing run from an ownership conflict. `training/publication.ts` validates and publishes artifacts using those transitions.

Training event reception runs outside the supervision loop, so an incomplete IPC frame cannot prevent cancellation or lease-loss checks. Child-process termination follows the [Worker lifecycle](vitroctl.md#workers).

Training recovery and artifact delivery follow the [operator workflow](vitroctl.md#workers); the control plane records metrics and recovery references, and publication verifies execution ownership.

The Python Worker receives a `TrainingClaim` in `worker/training.py`. Its protocol verbs are `claim`, `fetch_snapshot`, `enter_phase`, `renew_lease`, `report_epoch`, `download_image`, `publish_artifact` and `report_failure`; `serve_training_claim` owns execution.

## Wire contracts

Zod schemas in the Web package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/vitroctl/contracts`. A document is validated against its JSON Schema once, where it enters the process, and nested documents are decoded without re-validation. Validating `from_document` entries call decode-only `decode` constructors, which enforce domain semantics. `ImageDocuments` groups an image’s annotation documents for cross-document checks; `EpochReport.to_dict` and `EpochReport.from_document` serialize and read epoch reports. The `outbound` helper in `src/vitroctl/contracts/validation.py` validates detection results, training epoch reports, model publications, dataset manifest pushes and remote training recipes at the send boundary. `models/bundle.py:write_bundle` validates the manifest and weight identity before writing a bundle. Training-run documents admit nonnegative `attempt` values, and Worker IDs are at most 128 characters; owned execution requests require a positive attempt. `configs/yolo26/` contains bare recipe documents validated by the `training-recipe` contract, without a wrapper. `bun run contracts:generate` writes the schemas; `bun run contracts:check` detects stale output. The generated contracts are `annotation`, `dataset-manifest`, `detection-result`, `dish-recipe`, `inference-assignment`, `inference-model-manifest`, `model-bundle`, `training-epoch-report`, `training-parameters`, `training-recipe`, `training-run` and `training-snapshot`.

`WorkerProfile` in `src/vitroctl/worker/host/profiles.py` is the stored form of `WorkerSettings` in `src/vitroctl/worker/session.py`, without the resolved work directory. Both use `validate_worker_settings` in `src/vitroctl/worker/connection.py`. HTTP test seams use httpx `transport=`.

## Persistence and startup

`infra/db/connection.ts` knows drivers, pools, and raw connections. `infra/db/client.ts` owns the process connection and transaction helpers. `bootstrap.ts` supplies its initializer: it prepares a connection according to the [database schema policy](architecture.md#database-schema) and installs builtin models before publishing the shared handle, closing the connection if preparation fails. Model reads and immutable registration live in `models/registry.ts`; operations accept an executor to join a caller transaction. Bootstrap calls the public `installBuiltinModels` operation with the connection being prepared.

The framework server entry, maintenance tools, and the test preload call `bootstrap()`. Wiring is synchronous; the connection opens on first use, survives hot reload, and remains retryable after failure. A process entry point calls bootstrap before using application services. Long-running server and maintenance processes keep the connection for their lifetime. Importing a business module or the migration schema does not open a connection.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification are intentional last-line invariants. They enforce persistence rules across writers and concurrent requests.

Blobs are immutable by digest; Postgres owns application records. The blob driver only knows object keys and immutable bytes. `images/keys.ts` owns image keys, the model registry owns delivery keys, and `training/keys.ts` owns final-model part keys. `images/lock.ts` coordinates writes and references to each digest. `images/collection.ts` first expires unreferenced database rows, then sweeps objects under that lock. Model upload and registration serialize on their reservation. Expired unregistered uploads are collected under that same lock; registered version locations are independent of execution. Object upload and hashing finish before a training completion transaction takes its run lock. `training/collection.ts` collects final-model parts under the run lock. `maintenance/collection.ts` invokes the image, model, and training-artifact collectors. Collection runs outside request handling and upload transactions.

The images module owns canonical sources, previews, dish analysis, regional evidence and unclear marks. Its processing and maintenance rules are described in [Images](images.md); annotation evidence and overlays in [AI annotation](ai-annotation.md).

After `bun run build` in `web/`, `bun run maintenance` executes `dist/maintenance.js` as a long-running service. The finite analysis sweep is documented in [Images](images.md#maintenance); `bun run blobs:collect` executes `dist/collect-blobs.js` for one collection pass. The one-shot entries close the database before exit.

## Security boundary

API keys, MCP OAuth, browser sessions, and Worker tokens authenticate different principals. The Worker API's parent route admits only an enrolled Worker's token and hands the Worker it proves to every route beneath it. Account-based access follows the [agent authentication contract](agent-api.md#authentication) and [annotation authorization](ai-annotation.md#authorization). Authorization is decided at the adapter and answers only whether the request may proceed; the operation catalog runs without an identity.

## Module rule

Split a module when it owns more than one lifecycle. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from Worker orchestration, and connection mechanics are separate from application bootstrap. Protocol adapters project application operations.

## Annotation review

An annotation is one document per image and model. The annotation service holds the image lock while comparing the submitted base with the stored document and writing its replacement. No revision history or concurrency metadata travels in dataset annotations. The [draft lifetime](architecture.md#annotation-lifetime) defines the browser side of this transaction.
