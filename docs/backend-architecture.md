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

The source import rules and Vite protection are described in [Architecture](architecture.md#web-boundaries). Framework routes live in `web/src/routes/`, and Server Function adapters live in `web/src/functions/` and authorize through `web/src/functions/access.ts`. Read Server Functions use `get…` names; the list below follows `web/src/functions/`. Writes use create/update/remove verbs, including `updateCurrentVersion`, `createImageAnalysisRetry` and `updateUserStatus({ user, suspended })`.

| Server Function module | Reads |
| --- | --- |
| `datasets.ts` | `getDatasetDetail`, `getModelDatasets`, `getDatasetImageDetail` |
| `experiments.ts` | `getExperiments`, `getExperimentNames`, `getExperimentPage`, `getExperimentProgress`, `getPhotoSlots`, `getManualEntry`, `getPlacedPhotos`, `getUnitDetail` |
| `integrations.ts` | `getIntegrations`, `getOAuthClient` |
| `models.ts` | `getModels`, `getModelDetail`, `getVersionComparison` |
| `session.ts` | `getSession` |
| `training.ts` | `getTrainingRunDetail` |
| `users.ts` | `getUsers` |
| `workers.ts` | `getWorkers` |

Business modules and `queries/` expose a small `public.ts`. Cross-module callers import that entry; files inside a module import their siblings directly. Public entries export specific operations and contracts, not every internal function. Infrastructure capabilities and protocol adapters use explicit file entry points.

The allowed dependency graph lives in `web/scripts/architecture.ts`; the [architecture checker](architecture.md#web-boundaries) enforces it. Each server module has an explicit owner there.

Cross-module page queries depend on business modules; business modules never depend on those pages. For example, `queries/dataset-detail.ts` combines dataset records and training state, and datasets do not depend on training. Dataset review records remain in `datasets/` because both dataset transfer and training snapshot creation consume them. Image display names live in `queries/`: filenames belong to observation or dataset memberships, never to the global image asset.

List rows use `<Thing>Overview`, page read models use `<Thing>Detail` (for example, `UnitRowOverview` and `UnitDetail`), and readiness uses `DatasetTrainingReadiness`. These types are declared in each subject’s domain read-model module, including `web/src/domain/datasets/read-model.ts`. Each query function has its own file, named after the function, such as `queries/dataset-training-readiness.ts`; the parts several queries compose are named after what they read, as the experiment's are below. Server state predicates use `<subject>Is<State>`, such as `leaseIsHeld` and `attemptIsActive`. Lease-sensitive read models take one database time through `operationTime` and compare their leases against that time.

`infra/db/client.ts:single` requires one returned row, `training/snapshots.ts:requireSnapshot` requires a stored snapshot, and `images/records.ts:requireStoredImage` raises `ImageNotFoundError` for an absent image. Write paths obtain persisted timestamps from `operationTime(tx)`.

Modules use Drizzle directly. The shared foreign-key graph lives in one schema, and cross-table reads use joins. Multi-module writes share an executor and acquire locks in a consistent order. Import boundaries complement database ownership rules, constraints, and concurrency tests.

### Module map

Paths are relative to `web/src/server/`; tests sit beside their subjects.

| Module | Files and responsibilities |
| --- | --- |
| `agent/` | `operations.ts`, `definition.ts`, `execution.ts` and subject catalogs define and execute application operations. |
| `auth/` | `service.ts`, `users.ts`, `api-keys.ts`, `mcp-clients.ts`, `bearer.ts` and `programmatic-access.ts` own accounts and credentials. |
| `experiments/` | `records.ts` reads records; `design.ts`, `observations.ts`, `observation-images.ts`, `manual-readings.ts` and `culture-events.ts` own writes. |
| `datasets/` | `datasets.ts` owns memberships; `records.ts` reads contents and reviews; `transfer.ts` and `archive.ts` transfer them. |
| `models/` | `records.ts` counts references; registry, publication and bootstrap follow the lifecycles below. |
| `images/` | `store.ts`, `ingest.ts`, `records.ts`, `documents.ts` and `unclear.ts` own image records; processing, analysis, regions, previews and collection follow [Images](images.md). |
| `annotations/`, `annotation-runs/`, `readings/` | Reviewed documents, annotation execution and combined annotation layers follow [Annotation execution and layers](#annotation-execution-and-layers). |
| `inference/`, `workers/` | Attempts, demand, outcomes and tasks share Worker enrollment and sessions under the [Worker control planes](#worker-control-planes). |
| `training/` | `records.ts` decodes state, `runs-access.ts` checks access, `control.ts` handles controls, `attempts.ts` reads history, `targets.ts` selects Workers, and `snapshots.ts` freezes datasets; runs, epochs and publication follow [Training execution](#training-execution). |
| `queries/` | Page details, overview lists, image filenames, version comparisons and Worker presence combine business read models. |
| `infra/`, `maintenance/` | Database connections, blobs and digests support persistence; `maintenance/collection.ts` coordinates collectors. |
| `transport/http/`, `transport/mcp/` | HTTP handlers and MCP adapters implement protocol contracts. |
| `testing/` | Fixtures support server tests outside the production graph. |

## Agent control plane

`agent/operations.ts` assembles a protocol-neutral catalog from one file per subject: `agent/experiments.ts` owns the experiment's design and records and reads the sheet a page of rows at a time (`domain/experiments/sheet.ts`; the summary over every row is `domain/experiments/summary.ts`), `agent/datasets.ts` the datasets, `agent/models.ts` models and model delivery, `agent/training.ts` training runs, and `agent/inference.ts` inference task control. Definitions live in `agent/definition.ts`. An entry declares a query or command, whether a command is destructive, its input/output contracts, its transaction ownership, and its handler. `agent/execution.ts` parses input, invokes the handler, validates output, and classifies failures. Commands declaring `transaction: "operation"` receive a required executor and run inside one operation transaction; their handlers must use that executor. Queries and service-owned commands have no executor parameter. Services that own their transactions declare `transaction: "service"`, so uploads and multi-stage workflows are not wrapped in an outer database transaction. Queries do not open a write transaction.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. Transaction owners enforce atomic state changes. Staged model delivery uses idempotent upload reservations; repeating an interrupted transfer under the same reservation is accepted.

## Worker control planes

An administrator enrolls each Worker under a name, and the token issued then is the Worker's identity: the workbench keeps only its hash, resolves every Worker request to its Worker from the token, and never reads a Worker ID from a request. Removing the Worker revokes the token and ends its session. A fresh session ID fences one process incarnation from another. `workers` holds the enrolled Workers; `worker_sessions` holds each one's current session: the runtimes it executes, the memory it offers, and when it was last heard from. `queries/worker-presence-detail.ts` implements `workerPresenceDetail`: presence derives from heartbeat age, and activity derives from the held lease. Activity is null or `{kind, subject}`: inference names an image digest and nullable filename; training names a run and dataset.

Inference separates durable work, execution attempts and successful results. `inference/demand.ts` materializes experiment and validation demand into unique image/version tasks without requiring an available Worker. `inference_tasks` retains queued, running, succeeded or terminally failed state. `inference_attempts` retains every execution identity, Worker/session, start, immutable deadline, lease, completion receipt and failure. Removing a Worker retains this history. `inference_outcomes` stores one immutable successful detection per image and version, including zero-box results.

`inference/attempts.ts` atomically leases at most one inference task per Worker. A claim of a `dish` version resolves the image's current dish coverage into the assignment and logs `inference-task.full-image-coverage` when there is none; other versions are handed null. Repeating a claim returns the live attempt without extending its deadline. Both training and inference claims lock the Worker session and refuse to allocate while the other queue holds the accelerator. Inference renewals and submissions also lock the session, then the task; result storage acquires the detection lock last. Each owned operation checks the attempt number in addition to Worker/session. Database uniqueness constraints enforce one running attempt per task and per Worker.

Each lease operation samples the database wall clock once after acquiring its ownership lock and reuses that timestamp for ownership predicates, update fences and lease expiry. Renewal is capped by the fixed deadline; a heartbeat is presence, never evidence of execution progress. `inference/tasks.ts` owns expiry, retry and inspection. Reclamation locks tasks with `SKIP LOCKED` and re-reads attempts after locking, so a concurrent renewal is not mistaken for expiry. [Maintenance](images.md#maintenance) and claims use the same expiry transition. Claim-time reconciliation commits before locking the Worker slot, keeping cross-task recovery locks out of the allocation transaction. A task executes at most three attempts, with 5/10-second retry delays; a Worker whose attempt failed has a 60-second cooldown derived from its attempt history, independent of session restarts. Other Workers can take over after the retry delay. An explicit retry resets only the retry budget, not the monotonic attempt number or history.

Successful result storage, task completion and the attempt's canonical result digest commit in one transaction. Identical completed submissions replay that receipt; an expired, superseded or differently submitted attempt is rejected. An attempt failure is reported separately and never fabricated as a detection. Image reviews and model comparisons show terminal failures; the experiment MCP/HTTP operations expose task history and explicit retry. Once materialized, a task remains durable even if its model is not selected; successful results remain reusable if that version is selected again.

A Worker process supervises a warm child process that owns downloads, model loading and prediction. Supervision uses a monotonic clock derived from server durations, bounded HTTP exchanges and interruptible IPC. The child process is terminated on lost ownership, timeout, error, shutdown or before training. Inference deadlines are 10 minutes for the traditional detector and `min(30 minutes, 10 minutes + 2 minutes × ceil((imageSize / 1024)²))` for Ultralytics, covering cold loading and transfer. Leases are 90 seconds and renew every 20 seconds. These budgets are execution policy, not model identity. Tasks wait explicitly when no capable Worker exists; there is no overall queue-wait deadline.

`inference/attempts.ts` owns claim and execution orchestration and calls `inference/outcomes.ts` with the same executor when completing a task. Result validation never depends on the task orchestrator. `models/publication.ts` owns portable model bundles, upload reservations, immutable version registration, weight delivery and collection. Training publication validates execution ownership and delegates registration within its short completion transaction. An external import uses the same registry without creating a training run.

Production inference results enter through attempt completion. Tests seed detections or terminal task failures through `testing/inference.ts`; this fixture is outside the production module graph. Collection and outcome tests live alongside the image and inference modules that own those rules.

Inference and training share the roster and its ownership vocabulary—Worker, session, lease, and attempt—but each keeps its own state machine. Claims lock the Worker row, and every owned write carries the predicate that the session is still the roster's. A lease holds while it is unexpired and its session is still current; a restarted Worker process or a removed Worker loses ownership without waiting for its lease to expire. Inference then applies its bounded retry policy. Removing a Worker returns its work to the queue under each queue's recovery rules. A Worker process serves both queues, prioritizing training over inference, according to its advertised capabilities. The process owns the accelerator lifecycle: it releases the cached inference model before training and collects runtime allocations when training exits. Consecutive inference tasks may reuse the cached model.

## Annotation execution and layers

`annotation-runs/runs.ts` reads and validates the current image, model, input annotations and stored dish analysis under one image lock, then inserts the frozen definition and task plan in the same transaction; an image has at most one running run per model (`annotation_runs_active_idx`); a concurrent start for the same image and model is refused. `tasks.ts` finds the next region of the image's run in progress and owns regional previews and acceptance, `access.ts` resolves a task identifier to its region and run, locking both only to accept the region, and pure domain operations validate geometry and collect final results. `views.ts` reads shared context and regional evidence through images; rendering formats a stable run context separately from regional CLEAN and overlays; MCP content encoding belongs to `transport/mcp`. `queries/pending-annotations-detail.ts` implements `pendingAnnotationsDetail`, which lists the dataset and observation images with a run in progress, and supplies the annotation server’s [pending work](ai-annotation.md#tool-contract).

The `readings` module owns the image's combined annotation layers: stored human annotation, latest successful AI proposal, detection and the progress of a run in progress. Starting a run, MCP and workbench pages use that same read model. A page review adds the filename known by that page. `annotations` owns the human-reviewed document, and `annotation-runs` owns execution and acceptance. `readings/images.ts` owns the readings a query joins to each image it lists: the model's (`imageReadings`: annotation, proposal, run progress) and, where the caller names a version, that version's detection (`imageDetection`), every reading with its tally; they are plain joins, so a page of photographs looks each one up and a whole experiment is read in bulk. The detecting version is the caller's choice; the [reading rules](readings.md#where-the-numbers-come-from) distinguish the units table's counts from workbench display. Every stored detection, annotation and proposal keeps its per-class `tally` beside its document, a column the database generates with `document_tally`, so a count is read without opening a document.

An experiment's views read by row, each from parts named after what they read. `queries/experiment-design.ts` reads the design every view is read against. `queries/experiment-frame.ts` reads the frame every view stands in: the design with the size of each treatment, each observation's photographed, available and vacant counts, and how many photographs wait for their reading, each figure counted by the database, so no record is read into it. `queries/experiment-records.ts` reads the records of a set of units, photographs with their readings through `imageReadings` and `imageDetection` and counts entered by hand, and counts each observation's photographs and how many of the experiment's wait for their reading. `queries/experiment-unit-page.ts` cuts a page of units in the experiment's order and resolves their rows, and `queries/experiment-summary.ts` takes the summary over every row. The experiment page, the unit workbench, the agent's sheet and the spreadsheet export compose these; what an action on an observation needs is read when its dialog opens, each action reading its own part of the day (the units and which are photographed to place photographs, the datasets to add the day to a dataset, one treatment's units to enter counts), and which of a batch's photographs are already placed is asked of the server by digest. The experiment's order is total: treatments in their order, a treatment's units by code with numbers compared by value, and the unit's id where two codes read alike, so a page never repeats or drops a unit. Whether a unit is on the bench on a day is one rule, the day it left (`unitLeftOn`, and `benchExits` in SQL) against the day.

## Annotation review

An annotation is one document per image and model. The annotation service holds the image lock while comparing the submitted base with the stored document and writing its replacement. No revision history or concurrency metadata travels in dataset annotations. The [draft lifetime](architecture.md#annotation-lifetime) defines the browser side of this transaction.

## Training execution

`training/epochs.ts` owns epoch persistence. `training/runs.ts` owns run state transitions; each owned phase or epoch operation performs one `fencedUpdate`, which checks the Worker, session, attempt and live lease in the update predicate; lease renewal uses the same fence without changing business progress. `requireTrainingRun` distinguishes a missing run from an ownership conflict. `training/publication.ts` validates and publishes artifacts using those transitions.

`training/snapshots.ts` identifies snapshots with `documentDigest` from `infra/digest.ts`, hashing canonical JSON whose object keys are sorted by code unit, independent of locale. A snapshot freezes the model's area and, for a `dish` model, each image's dish coverage as `resolveDishCoverage` reads it from the dataset's image records, logging `training-snapshot.full-image-coverage` for the images that fall back to the whole image; `completeTrainingRun` refuses a bundle whose `inference.mode` is not the mode of the snapshot's area.

Training event reception runs outside the supervision loop, so an incomplete IPC frame cannot prevent cancellation or lease-loss checks. Child-process termination, recovery and artifact delivery follow the [operator workflow](seedctl.md#workers); the control plane records metrics and recovery references, and publication verifies execution ownership.

The Python Worker process receives a `TrainingClaim` in `worker/training.py`. Its protocol verbs are `claim`, `fetch_snapshot`, `enter_phase`, `renew_lease`, `report_epoch`, `download_image`, `publish_artifact` and `report_failure`; `serve_training_claim` owns execution.

## Wire contracts

Zod schemas in the workbench package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/seedctl/contracts`. A document is validated against its JSON Schema once, where it enters the process, and nested documents are decoded without re-validation. Validating `from_document` entries call `decode` constructors, which propagate a `context` path and enforce domain semantics. Nested-only documents expose `decode` without a validating entry. Annotation and detection decoders share `validate_instances` for instance IDs and bounds. `ImageDocuments` groups an image’s annotation documents for cross-document checks; `EpochReport.to_dict` and `EpochReport.from_document` serialize and read epoch reports. The `outbound` helper in `src/seedctl/contracts/validation.py` validates detection results, training epoch reports, model publications, dataset manifest pushes and remote training recipes at the send boundary. `models/bundle.py:validate_bundle` validates the manifest and weight identity; `write_bundle` atomically writes an already validated bundle. The CLI packaging sequence is validation, runtime verification, then writing; publication reads and validates the bundle directory with `read_bundle` before uploading it. Image decoding and traditional configuration and candidate-model loaders report invalid input with `ValueError`. Training-run documents admit nonnegative `attempt` values, and Worker IDs are at most 128 characters; owned execution requests require a positive attempt. `configs/yolo26/` contains bare recipe documents validated by the `training-recipe` contract, without a wrapper. `bun run contracts:generate` writes the schemas; `bun run contracts:check` detects stale output. The generated contracts are `annotation`, `dataset-manifest`, `detection-result`, `dish-recipe`, `inference-assignment`, `inference-model-manifest`, `model-bundle`, `training-epoch-report`, `training-parameters`, `training-recipe`, `training-run` and `training-snapshot`.

`WorkerProfile` in `src/seedctl/worker/host/profiles.py` is the stored form of `WorkerSettings` in `src/seedctl/worker/session.py`, without the resolved work directory. `WorkerProfile.settings()` builds a `WorkerSettings`, whose `__post_init__` validates the server URL, token, poll interval and device. `WorkerClient` takes a `WorkerConnection` and a `WorkerSession`; `authorized_client` in `src/seedctl/io/http.py` creates authenticated HTTP clients. `DEFAULT_POLL_SECONDS` in `worker/session.py` supplies the polling default. Training claims check their session ownership once when decoded by the client. HTTP test seams use httpx `transport=`. Protocol clients truncate failure text to 2,000 characters; process failures carry the exception message without a type prefix, falling back to the type name for an empty message.

## Persistence and startup

`infra/db/connection.ts` knows drivers, pools, and raw connections. `infra/db/client.ts` owns the process connection and transaction helpers. `bootstrap.ts` supplies its initializer by calling `prepareDatabase` in `models/bootstrap.ts`: it migrates the connection and installs built-in models before publishing the shared handle, closing the connection if preparation fails. The [database schema policy](architecture.md#database-schema) governs migrations. Model reads and immutable registration live in `models/registry.ts`; operations accept an executor to join a caller transaction. `requireModel` raises `ModelNotFoundError` for an absent model.

The framework server entry, maintenance tools, and the test preload call `bootstrap()`. Wiring is synchronous; the connection opens on first use, survives hot reload, and remains retryable after failure. A process entry point calls bootstrap before using application services. Long-running server and maintenance processes keep the connection for their lifetime. Importing a business module or the migration schema does not open a connection.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification enforce persistence invariants. These rules apply across writers and concurrent requests.

Blobs are immutable by digest; Postgres owns application records. The blob driver only knows object keys and immutable bytes. `images/keys.ts` owns image keys, the model registry owns delivery keys, and `training/keys.ts` owns final-model part keys. `images/lock.ts` coordinates writes and references to each digest. `images/collection.ts` first expires unreferenced database rows, then sweeps objects under that lock. Model upload and registration serialize on their reservation. Expired unregistered uploads are collected under that same lock; registered version locations are independent of execution. Object upload and hashing finish before a training completion transaction takes its run lock. `training/collection.ts` collects final-model parts under the run lock. `maintenance/collection.ts` invokes the image, model, and training-artifact collectors. Collection runs outside request handling and upload transactions.

The images module owns canonical sources, previews, dish analysis, regional evidence and unclear marks. Its processing and maintenance rules are described in [Images](images.md); annotation evidence and overlays in [AI annotation](ai-annotation.md).

Built command entry points are listed in [Deployment](development.md#deployment). The one-shot entries close the database before exit.

## Security boundary

API keys, MCP OAuth, browser sessions, and Worker tokens authenticate different principals. The Worker API's parent route admits only an enrolled Worker's token and hands the Worker it proves to every route beneath it. Account-based access follows the [agent authentication contract](agent-api.md#authentication) and [annotation authorization](ai-annotation.md#authorization). Authorization is decided at the adapter and answers only whether the request may proceed; the operation catalog runs without an identity.

## Module rule

Split a module when it owns more than one lifecycle. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from Worker orchestration, and connection mechanics are separate from application bootstrap. Protocol adapters project application operations.
