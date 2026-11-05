# Agent API

The agent interface lets an AI agent keep an experiment's records: its design, the observations made of it, the photographs and counts entered by hand that give each unit its number on each day, and the culture events and unclear marks that take a unit out of the statistics. It exposes the workbench domain layer directly, so every request is validated by the same schemas and rejected by the same invariants as the workbench UI, and what an agent reads back is resolved by the same functions that fill the units table and the exported spreadsheet.

This guide covers the records surface and selected workflows. `GET /api/agent/operations` is the complete reference for all 46 operations, including model, training, inference and dataset commands.

One operation registry (`web/src/server/agent/operations.ts`) defines the interface, assembled from one file per subject under `web/src/server/agent/`. The HTTP surface and the MCP tool list are both projections of it; an operation name is part of the public contract.

## Authentication

A personal API key with the Experiment records scope opens both surfaces. It is issued under Integrations in the workbench and presented as a bearer token:

```
Authorization: Bearer vf_…
```

The agent acts as the account that issued the key. Every request resolves the current account and credential state, so revoking the key, suspending the account, or deleting the account denies the next request.

The MCP surface also opens to MCP clients the account approves through OAuth: see below.

## HTTP surface

| Request                     | Purpose                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/agent/operations` | Describe every operation: query/command kind, destructive flag, and input/output JSON Schemas |
| `POST /api/agent/<name>`    | Call one operation with its JSON input                                                        |
| `POST /api/agent/images`    | Store image bytes; the response is the digest a photograph is matched to its unit by          |

Every result is validated against the operation's published output schema before it leaves the workbench; for commands sharing the operation transaction, this validation must succeed before that transaction commits. Transaction ownership follows the [backend contract](backend-architecture.md#agent-control-plane). A successful call answers `{"result": ...}`. A failed call answers `{"error":{"code":"...","message":"..."}}`; HTTP maps the protocol-neutral code to the status describing what the agent can do about it:

- `400` — schema or domain validation fails, including a dataset/model mismatch or an unknown class in a manual count.
- `401` — the request presents no live API key with the Experiment records scope.
- `404` — the operation or the addressed record does not exist.
- `409` — a domain rule rejected the request, such as deleting an observation that holds records, or entering a count that leaves out a class the day counts; the message says which rule.
- `500` — a workbench defect; the body carries no detail, and the cause is in the server log.

```http
POST /api/agent/create-observation HTTP/1.1
Authorization: Bearer vf_…
Content-Type: application/json

{"experiment":"…","observedOn":"2026-09-02","modelId":"seed-detector"}
```

Experiment names, treatment names within an experiment, observation dates and unit codes identify duplicate creates, which return 409. Image uploads are idempotent; an existing digest is acknowledged successfully. Invalid source images return 400, while unexpected storage failures return 500.

Image upload posts the raw source bytes as the request body with an exact `Content-Length`, up to the [image size limit](domain.md#dataset-transfer). The returned digest identifies the [canonical image](images.md). Upload stores only the image by digest; assignment to a unit or dataset is a separate operation.

## MCP surface

`POST /api/experiments/mcp` is the experiment MCP server, serving MCP 2026-07-28 and 2025-06-18 Streamable HTTP clients. Its tools are exactly the operations of the registry. Drawing boxes follows the [annotation workflow and authorization](ai-annotation.md). Each tool carries the operation's input and output schemas and its behavior annotations, and a successful call returns the result as structured content.

Both MCP servers use stateless `createMcpHandler` adapters. Clients negotiating 2025-06-18 initialize before tool requests and send `MCP-Protocol-Version`; 2026-07-28 clients send protocol metadata on each request. A per-request server factory serves both lifecycles, with no session identifier or server-side session store.

An MCP client presents either credential. One configured with a request header sends the API key above; the key is checked as it is on the HTTP surface, and a key without the scope is challenged like a request with no credential.

For every other client the workbench is the OAuth 2.1 authorization server for its MCP servers. Discovery follows RFC 9728. A request without a valid access token answers 401 with a `WWW-Authenticate` challenge naming the protected resource metadata at `/.well-known/oauth-protected-resource/api/experiments/mcp`, from which a client discovers the authorization server, registers itself through a Client ID Metadata Document or dynamic registration, and sends the person to sign in and approve the connection. Tokens are bound to `<BETTER_AUTH_URL>/api/experiments/mcp`, so a token issued for the annotation server does not open this one. Every call also checks that the account, browser session, client, and consent remain active; disconnecting the client under Integrations denies its next call to either server. Host and browser Origin headers must name localhost or the `BETTER_AUTH_URL` hostname; non-browser MCP clients omit Origin, but their Host is still validated.

Both routes forward all HTTP methods to the MCP adapter. Host/Origin validation
and authentication run first: missing, invalid or revoked credentials receive
the OAuth challenge, including on GET probes. After authentication, only POST
is admitted; other methods receive `405 Method Not Allowed` with `Allow: POST`.
GET streams and DELETE sessions are not implemented.

OAuth resource requests use Better Auth's verifier for both Bearer and DPoP access tokens. A DPoP-bound token requires the client's signed proof for the request URL, method and access token; a reused proof is refused. Account and client authorization are checked on every request, including after a valid proof. Initialization uses the shared, retryable auth service.

Better Auth verifies OAuth and issues challenges; the MCP SDK handles POST exchanges. Client ID Metadata Documents use a transport that resolves DNS once, rejects non-public addresses, pins the connection to a validated address, verifies TLS for the original hostname and refuses redirects.

Add the experiment server to a local client, replacing `<workbench>` with the deployment hostname:

```bash
claude mcp add --transport http vitroflow-experiments 'https://<workbench>/api/experiments/mcp'
codex mcp add vitroflow-experiments --url 'https://<workbench>/api/experiments/mcp'
```

Image bytes use the [HTTP upload surface](#http-surface); MCP operations take the returned digest. A hosted client needs access to the source bytes and a way to send an authenticated HTTP body; attaching a photograph to its chat does not itself upload it to VitroFlow. Annotation image delivery is described in [AI annotation](ai-annotation.md#evidence-and-caches).

## Error contract

Domain error classes inherit `ValidationError` for `<subject>_invalid` or `<subject>_mismatch`, `ConflictError` for `<subject>_name_taken` or `<subject>_conflict`, and `NotFoundError` for `<subject>_not_found`. Protocol adapters classify these domain errors: the agent transport emits `invalid_request`, `conflict`, `not_found`, `unauthorized` or `internal_error`. Agent HTTP and MCP error bodies carry that category as `code` and a diagnostic `message`; they do not carry the domain code. The domain codes used inside the application are:

| Subject | Codes |
| --- | --- |
| annotation | `annotation_conflict` |
| annotation-runs | `annotation_run_conflict`, `annotation_run_not_found` |
| auth | `user_not_found`, `user_account_conflict`, `api_key_not_found`, `mcp_client_not_found` |
| datasets | `dataset_not_found`, `dataset_model_mismatch`, `dataset_import_invalid`, `dataset_name_taken`, `dataset_manifest_too_large` |
| experiments | `experiment_not_found`, `experiment_observation_image_not_found`, `observation_not_found`, `treatment_not_found`, `unit_not_found`, `culture_event_not_found`, `experiment_name_taken`, `experiment_records_conflict`, `image_storage_conflict`, `observation_conflict`, `observation_model_counts_conflict`, `treatment_name_taken`, `treatment_conflict`, `unit_conflict`, `unit_selection_conflict`, `observation_image_conflict`, `manual_reading_conflict`, `experiment_observation_image_conflict`, `unit_name_taken` |
| images | `image_not_found`, `image_source_invalid` |
| inference | `detection_conflict`, `detection_outcome_invalid`, `detection_image_not_found`, `producer_mismatch`, `inference_attempt_conflict` |
| models | `model_not_found`, `model_version_not_found`, `model_upload_not_found`, `model_name_taken`, `model_usage_conflict`, `class_invalid`, `model_publication_invalid` |
| training | `training_run_conflict`, `training_run_not_found`, `training_artifact_invalid` |
| workers | `worker_not_found`, `worker_name_taken`, `worker_session_conflict` |

`dataset_manifest_too_large` and `class_invalid` map to `invalid_request`. Unknown manual-count and inference classes use `class_invalid`; a missing annotation image uses `image_not_found`. Assignment conflicts use `ObservationImageConflictError` (`observation_image_conflict`) and `ExperimentObservationImageConflictError` (`experiment_observation_image_conflict`).

Both MCP servers report tool handler failures as `isError: true` with JSON `{ "code": "…", "message": "…" }` in text content. The MCP SDK owns argument validation before handlers run.

HTTP image and weight uploads, Worker artifact parts and dataset manifest PUTs share `exactLengthBody` admission in `transport/http/upload-body.ts`. A declared size above the endpoint's limit or bytes exceeding `Content-Length` return 413; the size-limit message derives from that endpoint's byte limit. Missing or invalid length returns 411, and a short body returns 400. Every `/api/agent/*` error, including upload refusals, uses `{ "error": { "code": "…", "message": "…" } }`. Browser `/api/images` refusals use `{ "error": "…" }`, with a plain-text 500 for unexpected storage failure. Transfer responses are described [below](#transfer-surface). Worker API errors are plain text: invalid detection outcomes return 422, a missing training run returns 404, and a run the caller does not own returns 409.

## Transfer surface

`GET /api/transfer/datasets/:dataset` returns the JSON manifest, plain-text 404 for an unknown dataset, or 422 with `{ "error": "…" }` when the exported manifest exceeds its limit. `PUT` returns 201 with `{ "dataset": "…" }`; an unknown model returns 404 and `DatasetImportInvalidError` returns 409. Invalid JSON, an invalid manifest or a mismatched dataset name returns 400. Upload admission and import refusals use `{ "error": "…" }`.

`GET /api/transfer/images/:digest` returns canonical image bytes or plain-text 404. `PUT` returns `{ "digest": "…" }`; an invalid digest, invalid canonical image or digest mismatch returns 400, and unexpected storage failures return 500, all with `{ "error": "…" }`. Transfers follow the [dataset limits and rules](domain.md#dataset-transfer).

## Design and records

`create-experiment` lays out the first treatments. `create-treatment` and `add-replicates` extend the design; `update-unit` and `move-units` correct codes and treatment assignments. The update and delete operations enforce the [record lifetimes](domain.md#experimental-design).

`move-units` takes up to 200 unit ids, and moves all of them or none. `record-culture-events` takes its `units` the same way, or as `{ "treatment": "<id>", "expected": n }` for every unit of one treatment, or `{ "treatment": null, "expected": n }` for every unit of the experiment, where `expected` is how many units the selection held when it was made; a selection that now holds another number is refused as a `conflict` (`unit_selection_conflict` within the application). Units named one by one must each take the event, or none does and the command is refused as a `conflict` (`unit_conflict`). Of a selection, the units that cannot take it are passed over: the result lists the units `recorded`, each with its `event`, and those `passedOver`, each with its `code` and `reason` (`recorded`, the event is already on that day; `already_left`, the unit already left the bench and the event would take it off again; `left_before`, it left the bench before that day; `later_records`, it has records after a day it would leave on).

## The sheet

`get-experiment` reads the experiment's sheet a page of units at a time, and `get-unit` one unit's row of it. The sheet is the design (`experiment`, `treatments`, `observations`) and, under `units`, the page: `rows`, each a unit with its cell on every observation, `treatment`, `total`, the number of units pages are drawn from, `page`, `pageSize` and `pages`, how many pages there are (at least 1). The input takes `treatment` to draw pages from one treatment's units (all units when omitted or null; a treatment the experiment does not have is `not_found`), `page` from 1 (default 1; a page past the last holds no rows) and `pageSize` from 1 to 200 (default 50). Units come in the experiment's order: treatments in their order, and a treatment's units by code, numbers compared by value. Each cell is resolved for the statistics (see [readings](readings.md)):

- `reading` is the resolved count and its source (`manual`, `review`, `proposal` or `detection`), or null; resolution follows the [reading rules](readings.md#where-the-numbers-come-from).
- `exclusion` is an `event` or `unclear` reason, or null, under the [exclusion rules](readings.md#what-takes-a-unit-out-of-the-statistics).
- `image` carries the observation image `id`, digest, `filename`, state, `error`, three tallies and unclear mark.
- `manual` carries the count entered by hand, as a class tally and recording time.

A cell with neither reading nor exclusion has no resolved count or exclusion reason; it can still hold a photograph awaiting a reading. Agents follow the [resolved-sheet rules](readings.md#what-an-agent-reads).

`get-experiment-summary` reads the summary of every unit, whichever page is read: `baseline` and `cells`, with one cell per treatment and observation. Each cell carries the count and rate statistics (`n`, `mean`, `sd`, `se`); a unit's own numbers are on its row in `get-experiment`. Their [meaning and nullability](readings.md#what-the-summary-says) match the workbench and spreadsheet.

## Entering a day

A day enters as an observation and the records taken on it, by either or both of two ways: photographs the workbench reads, and counts entered by hand.

1. `get-experiment` reads the sheet: treatments, units with their codes, a page at a time, and the observations already made.
2. `create-observation` adds the observation date, the model its photographs are read for, and `countedClasses`, the classes the day's count sums, every class when omitted; a germination trial's later days count `["germinated"]`. When the photographs are already uploaded, `images` matches them to their units in the same step, so the day and its photographs enter together or not at all; omit it to plan a day first.
3. Upload each photo through the [HTTP surface](#http-surface). `assign-images-to-observation` matches digests to units in an observation that already exists, keeping each source filename for traceability; a unit already photographed that day is given its replacement. Filenames may suggest unit codes, but the unit id in the assignment is authoritative.
4. `enter-manual-readings` submits counts entered by hand as class tallies per unit; `null` withdraws a tally. The [reading rules](readings.md#where-the-numbers-come-from) define completeness and precedence.
5. `mark-image-unclear` and `clear-image-unclear` address an image by digest. Repeated calls return `marked: false` or `cleared: false` when there is nothing to change. Assignment entries also accept `unclear: true`. The experiment's `countsUnclear` setting is accepted by `create-experiment` and `update-experiment`; [exclusion rules](readings.md#what-takes-a-unit-out-of-the-statistics) define its effect.
6. `record-culture-events` records an event for several units at one observation; `delete-culture-event` removes a mistaken event.

Reading needs no request: matched photographs are queued for the current version of their observation's model automatically, and `retry-observation-image-analysis` requeues one that failed. Version selection follows the [model lifecycle](domain.md#models-and-versions). A model with no current version queues nothing; its photographs can be read by a reviewer or an annotation agent, and `create-model` names such a model in the first place.

## Dataset workflow

Photographs that a reviewer has annotated become training material once they belong to a dataset for their observation's model:

1. `get-experiment` reads the sheet; each cell's `image` carries the observation image `id` that names the photograph.
2. `list-datasets` shows the datasets for a model by id and name, with how many images each holds and how many are reviewed. The [dataset rules](domain.md#dataset-transfer) define training eligibility.
3. `create-dataset` names an empty dataset for a model. The name is unique whatever its case and stays filename-safe, because transfer and `vitroctl` data roots know a dataset by name; `update-dataset` renames it later without touching its images, splits, snapshots, or runs. Every other dataset tool addresses the dataset by its id.
4. `add-images-to-dataset` adds observation images to a dataset, named one by one or as `{ "experiment", "observation" }` for every photograph of one observation, which must hold one. One call takes images observed for the dataset's model; images already in the dataset are counted as `existing`, so repeating a call is safe.
5. `get-dataset` lists a dataset's images by digest, each with whether it is reviewed, whether a person marked it `unclear`, and its training split; the digests match the photographs in the sheet's cells.
6. `remove-images-from-dataset` takes images out by digest, for example a blurred photo or a unit found contaminated. The [dataset lifetime rules](domain.md#dataset-transfer) apply; digests not in the dataset are counted as `absent`, so repeating a call is safe.

The train/validation split is not chosen here: a training snapshot gives each reviewed image a split it keeps from then on.

## Transactions

Record commands such as entering counts, moving units and creating an observation with photographs commit atomically. The [backend contract](backend-architecture.md#agent-control-plane) defines transaction ownership.

## Inference task control

`get-inference-task` accepts `{ "versionId": "<model-version>", "digest": "<image-sha256>" }` and returns the durable task and its execution attempts, or null when no task has been materialized. Each attempt records its Worker, session, execution deadline, lease, final state and failure. `retry-inference-task` accepts the same target and resets a terminal failure's retry budget while retaining its attempt history. Successful results remain immutable. Experiment image reviews use the same retry operation internally.

## Training and model delivery

`list-training-workers`, `start-training-run`, `get-training-run`, `list-training-runs`, `control-training-run`, `list-model-versions`, `prepare-model-upload`, `register-model-upload` and `use-model-version` expose training and model delivery through both surfaces. The [operator workflow](vitroctl.md#training-and-model-delivery) describes recipes, recovery and local file uploads.
