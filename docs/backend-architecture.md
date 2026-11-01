# Backend architecture

The backend is a modular monolith. Business modules own lifecycles; protocol adapters, cross-module page queries, maintenance, and infrastructure have separate homes. It has four boundaries. Dependencies point inward; an inner layer does not describe an outer protocol.

```text
HTTP / MCP / worker routes
            │
            ▼
application operations and worker control planes
            │
            ▼
experiment, dataset, model, annotation, inference, and training domain services
            │
            ▼
database, immutable blob storage, and external runtimes
```

## Source boundaries

`web/src/server/` and the framework entry `web/src/server.ts` are server-only, enforced by the Vite client import protection. `web/src/domain/` contains shared schemas and pure transformations; it never imports server implementations, UI, or localization. The complete runtime-capability map is described in [Architecture](architecture.md). Framework routes live in `web/src/routes/`, and Server Function adapters live in `web/src/functions/`.

Business modules and `queries/` expose a small `public.ts`. Cross-module callers import that entry; files inside a module import their siblings directly. Public entries export specific operations and contracts, not every internal function. Infrastructure capabilities and protocol adapters use explicit file entry points instead of an all-purpose barrel.

`bun run architecture:check`, also part of `make check-web`, parses imports and re-exports, including type-only and literal dynamic imports. It checks public entry points, permitted dependency directions, browser/server separation, test isolation, and both file and module cycles. The allowed dependency graph lives in `web/scripts/architecture.ts`. Adding a new server module requires an explicit ownership decision there.

Cross-module page queries depend on business modules; business modules never depend on those pages. For example, `queries/dataset-overview.ts` combines dataset records and training state, so datasets do not depend back on training. Dataset review records remain in `datasets/` because both dataset transfer and training snapshot creation consume them. Image display names live in `queries/`: filenames belong to observation or dataset memberships, never to the global image asset.

Modules use Drizzle directly. The shared foreign-key graph lives in one schema, and cross-table reads use joins. Multi-module writes share an executor and acquire locks in a consistent order. Import boundaries complement database ownership rules, constraints, and concurrency tests.

## Agent control plane

`agent/operations.ts` assembles a protocol-neutral catalog; `agent/models.ts` owns model delivery operations and `agent/training.ts` owns training operations. Definitions live in `agent/definition.ts`. An entry declares a query or command, whether a command is destructive, its input/output contracts, its transaction ownership, and its handler. `agent/execution.ts` parses input, invokes the handler, validates output, and classifies failures. Commands that share an executor run inside an operation transaction. Services that own their transactions declare `transactional: false`, so uploads and multi-stage workflows are not wrapped in an outer database transaction. Queries do not open a write transaction.

HTTP maps failure codes to status codes. MCP derives tool annotations and formats tool errors. Neither choice leaks back into the catalog. Transaction owners enforce atomic state changes; staged model delivery uses idempotent upload reservations so an interrupted transfer can be retried.

## Worker control planes

An administrator enrolls each worker under a name, and the token issued then is the worker's identity: the workbench keeps only its hash, resolves every worker request to its worker from the token, and never reads a worker ID from a request. Removing the worker revokes the token and ends its session. A fresh session ID fences one process incarnation from another. `workers` holds the enrolled machines; `worker_sessions` holds each one's current session: the runtimes it executes, the memory it offers, and when it was last heard from. Presence is the heartbeat age; what a worker is doing is the lease it holds, never a second copy in the roster.

Inference separates durable work, execution attempts and successful results. `inference/demand.ts` materializes experiment and validation demand into unique image/version tasks without requiring an available Worker. `inference_tasks` retains queued, running, succeeded or terminally failed state. `inference_attempts` retains every execution identity, Worker/session, start, immutable deadline, lease, completion receipt and failure. Removing a Worker retains this history. `inference_outcomes` stores only immutable successful detections.

`inference/attempts.ts` atomically leases at most one inference task per Worker. Repeating a claim returns the existing live attempt without extending its deadline. Both training and inference claims lock the Worker session and refuse to allocate while the other queue holds the accelerator. Inference renewals and submissions also lock the session, then the task; result storage acquires the detection lock last. Each owned operation checks the attempt number in addition to Worker/session. Database uniqueness constraints enforce one running attempt per task and per Worker.

Server time is sampled after ownership locks. Renewal is capped by the fixed deadline; a heartbeat is presence, never evidence of execution progress. `inference/tasks.ts` owns expiry, retry and inspection. Reclamation locks tasks with `SKIP LOCKED` and re-reads attempts after locking, so a concurrent renewal is not mistaken for expiry. Maintenance and claims use the same expiry transition. Claim-time reconciliation commits before locking the Worker slot, keeping cross-task recovery locks out of the allocation transaction. A task executes at most three attempts, with 5/10-second retry delays; a failed Worker has a 60-second cooldown derived from its attempt history, independent of session restarts. Other Workers can take over after the retry delay. An explicit retry resets only the retry budget, not the monotonic attempt number or history.

Successful result storage, task completion and the attempt's canonical result digest commit in one transaction. Identical completed submissions replay that receipt; an expired, superseded or differently submitted attempt is rejected. An attempt failure is reported separately and never fabricated as a detection. The workbench and experiment MCP/HTTP operations expose task history and explicit retry. Once materialized, a task remains durable even if its model is no longer selected; successful results remain reusable if that version is selected again.

A Worker supervises a warm child process that owns downloads, model loading and prediction. Supervision uses a monotonic clock derived from server durations, bounded HTTP exchanges and interruptible IPC. The process is terminated on lost ownership, timeout, error, shutdown or before training. Inference deadlines are 10 minutes for the traditional detector and `min(30 minutes, 10 minutes + 2 minutes × ceil((imageSize / 1024)²))` for Ultralytics, covering cold loading and transfer. Leases are 90 seconds and renew every 20 seconds. These budgets are execution policy, not model identity. Tasks wait explicitly when no capable Worker exists; there is no overall queue-wait deadline.

`inference/attempts.ts` owns claim and execution orchestration and calls `inference/outcomes.ts` with the same executor when completing a task. Result validation never depends on the task orchestrator. `training/runs.ts` owns run state transitions; `training/publication.ts` validates and publishes artifacts using those transitions. `models/publication.ts` owns portable model bundles, upload reservations, immutable version registration, weight delivery and collection. Training publication validates execution ownership and delegates registration within its short completion transaction. An external import uses the same registry without creating a training run.

Production inference results enter through attempt completion. Tests seed detections or terminal task failures through `testing/inference.ts`; this fixture is outside the production module graph. Collection and outcome tests live alongside the image and inference modules that own those rules.

Inference and training share the roster and its ownership vocabulary—worker, session, lease, and attempt—but each keeps its own state machine. Claims lock the worker row, and every owned write carries the predicate that the session is still the roster's. A lease holds while it is unexpired and its session is still current, so a restarted or removed worker loses ownership without waiting for its lease to expire; inference then applies its bounded retry policy. A worker process serves both queues, prioritizing training over inference, according to its advertised capabilities. The process owns the accelerator lifecycle: it releases the cached inference model before training and collects runtime allocations when training exits. Consecutive inference tasks may reuse the cached model.

`annotation-runs/runs.ts` reads and validates the current image, model, input readings and stored dish analysis under one image lock, then inserts the frozen definition and task plan in the same transaction; the image's active run is unique, so concurrent starts cannot create two. Starting a run performs no image I/O or computation. `tasks.ts` finds the next region of the image's run in progress and owns regional previews and acceptance, `access.ts` resolves a task identifier to its region and run, locking both only to accept the region, and pure domain operations validate geometry and collect final results. `views.ts` reads shared context and regional evidence through images; rendering formats a stable run context separately from regional CLEAN and overlays; MCP content encoding belongs to `transport/mcp`. `queries/pending-annotations.ts` lists the dataset and observation images with a run in progress, then those no one has read for their model, which the annotation server offers agents as work.

The `readings` module owns the image's combined reading: stored human annotation, latest successful AI proposal, detection and the progress of a run in progress. Starting a run, MCP and workbench pages use that same read model. A page review adds the filename known by that page. `annotations` owns the human-reviewed document, and `annotation-runs` owns execution and acceptance. The read model uses stored data and inference selectors.

## Wire contracts

Zod schemas in the Web package are authoritative for documents shared with Python. `web/scripts/generate-contracts.ts` emits JSON Schema into `src/vitroctl/contracts`. Python validates that shared structure first, then its small decoders construct domain objects and enforce cross-field semantics. `make check` fails when generated schemas are stale.

## Persistence and startup

`infra/db/connection.ts` knows drivers, pools, and raw connections. `infra/db/client.ts` owns the process connection and transaction helpers. `bootstrap.ts` supplies its initializer: it migrates a connection and installs builtin models before publishing the shared handle, closing the connection if preparation fails. Model reads and immutable registration live in `models/registry.ts`; operations accept an executor to join an existing transaction. Bootstrap calls the public `installBuiltinModels` operation with the connection being prepared.

The framework server entry, maintenance tools, and the test preload call `bootstrap()`. Wiring is synchronous; the connection opens on first use, survives hot reload, and remains retryable after failure. A process entry point calls bootstrap before using application services. The one-shot collector closes the connection in `finally`; long-running server and maintenance processes keep it for their lifetime. Importing a business module or the migration schema does not open a connection.

Database checks, foreign keys, uniqueness constraints, advisory locks, immutable blob keys, and digest verification are intentional last-line invariants. They protect alternate writers and concurrency and should not be replaced with request validation alone.

The blob driver only knows object keys and immutable bytes. `images/keys.ts` owns image keys, the model registry owns delivery keys, and `training/keys.ts` owns final-model part keys. `images/lock.ts` coordinates writes and references to each digest. `images/collection.ts` first expires unreferenced database rows, then sweeps objects under that lock. Model upload and registration serialize on their reservation. Expired unregistered uploads are collected under that same lock; registered version locations are independent of execution. Object upload and hashing finish before a training completion transaction takes its run lock. `training/collection.ts` collects final-model parts under the run lock. `maintenance/collection.ts` invokes the image, model, and training-artifact collectors. Collection runs outside request handling and upload transactions.

The images module owns canonical sources, their previews, dish analysis,
regional evidence and the unclear marks people give them; experiments,
datasets and the agent catalog read and write marks through its public entry,
and each experiment decides whether its unclear photographs count. `images/preview.ts` derives one small rendition of the whole
frame per image; ingestion prepares it once the Image row is committed, a read
prepares one that is missing, and collection removes it with its image.
`images/dish.ts` owns one lazy compute thread per process for bounded OpenCV.js
thumbnail detection. Ordinary and canonical ingestion persist completed analysis
on the Image row, independently of region layout and annotation state. The recipe
identifies detection semantics and preprocessing; dependency inventories and
coverage policy do not participate in that identity. Starting a run only reads the
result, freezes coverage and tasks, and logs full-image fallback reasons.

`images/analysis-maintenance.ts` refreshes unavailable or obsolete results using
the same analyzer. Short row claims, persistent attempt times and a retry interval
keep failures from starving later images; result writes reject superseded
attempts. Completion counts only persisted results; superseded attempts and deleted
images count as skipped, separately from analysis failures. The maintenance entry
analyzes at most two images serially per cycle using one
Sharp processing thread. Analysis and blob collection have independent cadences
and infrastructure backoff. Resource budgets belong to each process, not a shared
cross-process processing gate. Compose and Zeabur declare both application roles
from one build definition; maintenance has no public port. Shared detection
parameters carry no manual version, while the server owns one implementation
revision for behavior changes not expressed by parameters.

Shared pure image geometry supplies task planning and evidence preparation.
`images/regions.ts` prepares lossless CLEAN regions and a base overview from one
canonical decode, persisting them under the source digest and renderer recipe.
A receipt identifies a completed plan; incomplete preparation reuses finished
assets. Dish coverage filters cores conservatively without clipping evidence.
`images/processing.ts` admits one large-image operation at a time across ingestion,
analysis and preparation within each process. Encoded caches are bounded; no
annotation state or model rules live in these assets.

Annotation context returns the unmarked overview and frozen rules under the run
identity. Annotation rendering owns reference and proposal overlays, with its own
bounded cache and render admission. Image collection roots source and derived
objects on the same Image row. Preparation does not hold database transactions or
introduce a separate service or job lifecycle.

## Security boundary

API keys, MCP OAuth, browser sessions, and worker tokens authenticate different principals. The worker API's parent route admits only an enrolled worker's token and hands the worker it proves to every route beneath it. The experiment and annotation MCP servers are separate OAuth protected resources: a token's audience names the one server it opens, and each also opens to a personal API key holding that server's scope. OAuth access is rechecked against the account, client, consent, and originating browser session on every request, and a key against its own state and its owner's, so revocation is immediate. Authorization is decided at the adapter and answers only whether the request may proceed; the operation catalog runs without an identity.

## Module rule

Split a module when it owns more than one lifecycle, not merely because it is long. Schema tables remain together while their foreign-key graph is the useful unit. Worker wire documents are separate from worker orchestration, and connection mechanics are separate from application bootstrap. New protocol adapters should project existing application operations rather than add a second execution path.

## Annotation review

An annotation is one current document per image and model. The page's readings carry the current annotation, and the draft takes its instances as the base it saves against. The session owns that base, its mutable draft, and undo/redo history; route refreshes replace them only while the draft is unedited. Submission freezes all draft changes. The save request includes the original instances (null for an unreviewed image); the annotation service holds the image lock while comparing that base with the current document and storing its replacement. A stale draft is refused and stays open. No revision history or concurrency metadata travels in dataset annotations.

The image viewport owns one transform whether or not the draft has been edited. Automatic fill follows the frame dimensions; manual placement uses the same scale interval and offset bounds. The effective scale is resolved before calculating a wheel gesture's anchor, and covering the frame takes precedence over the manual magnification limit.

Training recovery files remain on the Worker. Epoch reports record only metrics and a Worker/attempt/epoch recovery reference. Claims bind the run to its Worker; moving to another Worker requires an explicit restart. Final model weights use bounded part uploads through the workbench, followed by manifest verification and model registration.
