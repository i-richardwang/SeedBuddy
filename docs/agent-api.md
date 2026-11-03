# Agent API

The agent interface lets an AI agent keep an experiment's records: its design, the observations made of it, the photographs and counts entered by hand that give each unit its number on each day, and the culture events and unclear marks that take a unit out of the analysis. It exposes the workbench domain layer directly, so every request is validated by the same schemas and rejected by the same invariants as the workbench UI, and what an agent reads back is resolved by the same functions that fill the grid and the exported spreadsheet.

This guide covers the records surface and selected workflows. `GET /api/agent/operations` is the complete reference for all 45 operations, including model, training, inference and dataset commands.

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

Every result is validated against the operation's published output schema before it leaves the workbench; for commands sharing the operation transaction, this validation must succeed before that transaction commits. Uploads and other staged workflows own their transactions, so output validation at the adapter does not roll back an already completed stage. A successful call answers `{"result": ...}`. A failed call answers `{"error":{"code":"...","message":"..."}}`; HTTP maps the protocol-neutral code to the status describing what the agent can do about it:

- `400` — the input does not satisfy the operation's schema; the message names the offending fields.
- `401` — the request presents no live API key with the experiment records scope.
- `404` — the operation or the addressed record does not exist.
- `409` — a domain rule rejected the request, such as deleting an observation that holds records, or entering a count that leaves out a class the day counts; the message says which rule.
- `500` — a workbench defect; the body carries no detail, and the cause is in the server log.

```http
POST /api/agent/create-observation HTTP/1.1
Authorization: Bearer vf_…
Content-Type: application/json

{"experiment":"…","observedOn":"2026-09-02","modelId":"seed-detector"}
```

Every record an agent can create is named by something it already knows: an experiment by its name, a treatment by its name within the experiment, an observation by its date, a unit by its code, a dataset by its name, an image by its digest. Repeating a create therefore answers 409 rather than making a second record, so a call whose response was lost is safe to send again.

Image upload posts the raw source bytes as the request body with an exact `Content-Length`, up to 64 MiB. The image is canonicalized on entry, and the returned digest identifies the canonical bytes; identical uploads are idempotent.

## MCP surface

`POST /api/experiments/mcp` is the experiment MCP server, serving MCP 2026-07-28 and 2025-06-18 Streamable HTTP clients. Its tools are exactly the operations of the registry. Drawing boxes on images is the job of the [annotation MCP server](ai-annotation.md), which an agent connects to and is authorized for on its own. Each tool carries the operation's input and output schemas and its behavior annotations, and a successful call returns the result as structured content. The MCP server validates arguments against the tool's input schema itself, so a call whose arguments do not fit is refused before the operation runs.

Both MCP servers use `createMcpHandler` with `legacy: "stateless"`. Clients negotiating 2025-06-18 initialize before tool requests and send `MCP-Protocol-Version`; 2026-07-28 clients send protocol metadata on each request. A per-request server factory serves both lifecycles, with no session identifier or server-side session store.

An MCP client presents either credential. One configured with a request header sends the API key above; the key is checked as it is on the HTTP surface, and a key without the scope is challenged like a request with no credential.

For every other client the workbench is the OAuth 2.1 authorization server for its MCP servers. A request without a valid access token answers 401 with a `WWW-Authenticate` challenge naming the protected resource metadata at `/.well-known/oauth-protected-resource/api/experiments/mcp`, from which a client discovers the authorization server, registers itself through a Client ID Metadata Document or dynamic registration, and sends the person to sign in and approve the connection. Tokens are bound to `<BETTER_AUTH_URL>/api/experiments/mcp`, so a token issued for the annotation server does not open this one. Every call also checks that the account, browser session, client, and consent remain active; disconnecting the client under Integrations denies its next call to either server. Host and browser Origin headers must name localhost or the `BETTER_AUTH_URL` hostname; non-browser MCP clients omit Origin, but their Host is still validated.

Both routes forward all HTTP methods to the MCP adapter instead of allowing
unhandled requests to fall through to page rendering. Host/Origin validation
and authentication run first: missing, invalid or revoked credentials receive
the OAuth challenge, including on GET probes. After authentication, only POST
is admitted; other methods receive `405 Method Not Allowed` with `Allow: POST`.
GET streams and DELETE sessions are not implemented.

Better Auth verifies OAuth and issues challenges; the MCP SDK handles POST exchanges. Client ID Metadata Documents use a transport that resolves DNS once, rejects non-public addresses, pins the connection to a validated address, verifies TLS for the original hostname and refuses redirects.

Configure each MCP endpoint in the client's HTTP connector and authorize each resource separately.

Image bytes do not travel through MCP. Upload them to `POST /api/agent/images` and pass the returned digest to `create-observation` or `assign-images-to-observation`.

## Design and records

`create-experiment` lays out the first treatments. `create-treatment` and `add-replicates` extend the design; `update-unit` and `move-units` correct codes and treatment assignments. The update and delete operations enforce the [record lifetimes](domain.md#experimental-design).

## The sheet

`get-experiment` reads the experiment's sheet, and `get-unit` one unit's row of it. The sheet is the design and a cell for every unit on every observation, each cell resolved as the analysis reads it (see [readings](readings.md)):

- `reading` is the count the day uses for the unit and its `source`: `manual` for a count a person entered, else `review`, `proposal`, or `detection` for the best reading its photograph has. It is null while the cell has no number: no photograph or count yet, a photograph not yet read, or a count that left a class the day counts unanswered.
- `exclusion` says why the day stays out of the analysis, or is null when it is in: an `event` names the culture event that took the unit out, and `unclear` says a photograph of the unit was marked unclear in an experiment that does not count such photographs. A reading may be present on an excluded day; the analysis does not use it, and a sheet exported from the workbench writes the reason in its place.
- `image` is the photograph behind the cell: its observation image `id`, which datasets add it by; its `digest`, which marks and dataset removal address it by; its reading `state`; the three tallies it may carry; and whether it is `unclear`.
- `manual` is the count a person entered: its `tally` by class and when it was recorded.

A cell with neither reading nor exclusion has nothing yet. An agent reads numbers from the sheet; it never ranks a photograph's readings against an entered count or applies the exclusion rules itself.

Under the cells, `summary` contains `baseline` and one entry per treatment and observation. Each entry carries its units, counts, rates and statistics (`n`, `mean`, `sd`, `se`). Their [meaning and nullability](readings.md#what-the-summary-says) match the workbench and spreadsheet.

## Entering a day

A day enters as an observation and the records taken on it, by either or both of two ways: photographs the workbench reads, and counts a person took at the bench.

1. `get-experiment` reads the sheet: treatments, units with their codes, and the observations already made.
2. `create-observation` adds the observation date, the model its photographs are read for, and `countedClasses`, the classes the day's count sums, every class when omitted; a germination trial's later days count `["germinated"]`. When the photographs are already uploaded, `images` matches them to their units in the same step, so the day and its photographs enter together or not at all; omit it to plan a day first.
3. `POST /api/agent/images` stores each photo and returns its digest. `assign-images-to-observation` matches digests to units in an observation that already exists, keeping each source filename for traceability; a unit already photographed that day is given its replacement. Filenames may suggest unit codes, but the unit id in the assignment is authoritative.
4. `enter-manual-readings` submits counts entered by hand as class tallies per unit; `null` withdraws a tally. The [reading rules](readings.md#where-the-numbers-come-from) define completeness and precedence.
5. `mark-image-unclear` and `clear-image-unclear` address an image by digest. Repeated calls return `marked: false` or `cleared: false` when there is nothing to change. Assignment entries also accept `unclear: true`. The experiment's `countsUnclear` setting is accepted by `create-experiment` and `update-experiment`; [exclusion rules](readings.md#what-takes-a-unit-out-of-the-analysis) define its effect.
6. `record-culture-events` records an event for several units at one observation; `delete-culture-event` removes a mistaken event.

Reading needs no request: matched photographs are queued for the current version of their observation's model automatically, and `retry-observation-image-analysis` requeues one that failed. A trained version is a candidate until selected on the model page or through `use-model-version`. A model with no current version queues nothing; its photographs wait for a reviewer, and `create-model` names such a model in the first place.

## Dataset workflow

Photographs that a reviewer has annotated become training material once they belong to a dataset for their observation's model:

1. `get-experiment` reads the sheet; each cell's `image` carries the observation image `id` that names the photograph.
2. `list-datasets` shows the datasets for a model by id and name, with how many images each holds and how many are reviewed. Training uses only reviewed images.
3. `create-dataset` names an empty dataset for a model. The name is unique whatever its case and stays filename-safe, because transfer and `vitroctl` data roots know a dataset by name; `update-dataset` renames it later without touching its images, splits, snapshots, or runs. Every other dataset tool addresses the dataset by its id.
4. `add-images-to-dataset` adds observation images to a dataset. One call takes images observed for the dataset's model; images already in the dataset are counted as `existing`, so repeating a call is safe.
5. `get-dataset` lists a dataset's images by digest, each with whether it is reviewed, whether a person marked it `unclear`, and its training split; the digests match the photographs in the sheet's cells.
6. `remove-images-from-dataset` takes images out by digest, for example a blurred photo or a unit found contaminated. The images and their reviews remain, and snapshots already taken keep what they froze; digests not in the dataset are counted as `absent`, so repeating a call is safe.

The train/validation split is not chosen here: a training snapshot gives each reviewed image a split it keeps from then on.

## Transactions

Record commands such as entering counts, moving units and creating an observation with photographs commit atomically. The registry declares whether the operation or its service owns the transaction; staged uploads use service-owned transactions. The [backend contract](backend-architecture.md#agent-control-plane) defines this boundary.

## Inference task control

`get-inference-task` accepts `{ "versionId": "<model-version>", "digest": "<image-sha256>" }` and returns the durable task and its execution attempts, or null when no task has been materialized. Each attempt records its Worker, session, execution deadline, lease, final state and failure. `retry-inference-task` accepts the same target and resets a terminal failure's retry budget while retaining its attempt history. Successful results remain immutable. Experiment image reviews use the same retry operation internally.
