# Agent API

The agent interface lets an AI agent keep an experiment's records: its design, the observations made of it, the photographs and hand counts that give each unit its number on each day, and the culture events and unclear marks that take a unit out of the analysis. It exposes the workbench domain layer directly, so every request is validated by the same schemas and rejected by the same invariants as the workbench UI, and what an agent reads back is resolved by the same functions that fill the grid and the exported spreadsheet.

One operation registry (`web/src/server/agent/operations.ts`) defines the interface, assembled from one file per subject under `web/src/server/agent/`. The HTTP surface and the MCP tool list are both projections of it; an operation name is part of the public contract.

## Authentication

A personal API key with the **Experiment records** scope opens both surfaces. It is issued under Integrations in the workbench and presented as a bearer token:

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

Every result is validated against the operation's published output schema before it leaves the workbench; for commands this validation must succeed before the transaction commits, so the discovery document is the contract on both sides of a call. A successful call answers `{"result": ...}`. A failed call answers `{"error":{"code":"...","message":"..."}}`; HTTP maps the protocol-neutral code to the status describing what the agent can do about it:

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

Both MCP servers use the official TypeScript SDK's `createMcpHandler` with
`legacy: "stateless"`, following its [legacy-client guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md)
and the specification's [dual-era versioning rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).
Clients such as Codex that negotiate 2025-06-18 use `initialize`,
`notifications/initialized`, then tool requests with `MCP-Protocol-Version`.
2026-07-28 clients send protocol metadata on each request. The SDK handles
both lifecycles through the same per-request server factory, and
authentication runs before either lifecycle. No session identifier or server-side
session store is created. This compatibility mode does not enable the old
HTTP+SSE transport.

An MCP client presents either credential. One configured with a request header sends the API key above; the key is checked as it is on the HTTP surface, and a key without the scope is challenged like a request with no credential.

For every other client the workbench is the OAuth 2.1 authorization server for its MCP servers. A request without a valid access token answers 401 with a `WWW-Authenticate` challenge naming the protected resource metadata at `/.well-known/oauth-protected-resource/api/experiments/mcp`, from which a client discovers the authorization server, registers itself through a Client ID Metadata Document or dynamic registration, and sends the person to sign in and approve the connection. Tokens are bound to `<BETTER_AUTH_URL>/api/experiments/mcp`, so a token issued for the annotation server does not open this one. Every call also checks that the account, browser session, client, and consent remain active; disconnecting the client under Integrations denies its next call to either server. Host and browser Origin headers must name localhost or the `BETTER_AUTH_URL` hostname; non-browser MCP clients omit Origin, but their Host is still validated.

Both routes forward all HTTP methods to the MCP adapter instead of allowing
unhandled requests to fall through to page rendering. Host/Origin validation
and authentication run first: missing, invalid or revoked credentials receive
the OAuth challenge, including on GET probes. After authentication, only POST
is admitted; other methods receive `405 Method Not Allowed` with `Allow: POST`.
GET streams and DELETE sessions are not implemented.

This follows the [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
and [authorization discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
contracts. [Better Auth](https://better-auth.com/docs/plugins/mcp) owns OAuth
verification and challenges; the SDK owns POST exchanges. Its Next.js example
lets the framework reject unsupported methods before authentication. Here,
authentication precedes method rejection so login probes receive discovery
information through the same protected-resource boundary.

Codex can use its HTTPS client metadata document as `client_id`, as described
in the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
The [Better Auth CIMD transport](https://better-auth.com/docs/plugins/cimd)
resolves DNS once, rejects non-public addresses, pins the connection to a
validated address, verifies TLS for the original hostname, and refuses
redirects. Keep the Better Auth packages together at 1.7.7 or later: the
1.7.2 Node transport returned a scalar DNS result even when HTTPS requested
an address array, causing `invalid_client` with “network error or redirect
blocked” before a connection was made.

For Codex, configure each URL and log in separately:

```bash
codex mcp add vitroflow-experiments --url https://<workbench>/api/experiments/mcp
codex mcp add vitroflow-annotation --url https://<workbench>/api/annotation/mcp
codex mcp login vitroflow-experiments
codex mcp login vitroflow-annotation
```

Connect with:

```bash
claude mcp add --transport http vitroflow-experiments https://<workbench>/api/experiments/mcp
```

Image bytes do not travel through MCP. Upload them to `POST /api/agent/images` and pass the returned digest to `create-observation` or `assign-images-to-observation`.

## Design and records

An experiment is a design and the records taken against it. The design is its treatments, their units, and its observations: `create-experiment` lays out the first treatments, `create-treatment` and `add-replicates` extend them, `update-unit` and `move-units` correct a unit's code or treatment while it keeps its identity and records, and `update-*` corrects any entry. A record is a photograph matched to a unit on an observation, a count entered by hand for it, or a culture event. A record keeps its unit, treatment, and observation from being deleted, so `delete-experiment`, `delete-treatment`, `delete-unit`, and `delete-observation` answer 409 for an entry that holds any; the experiment's last treatment and a treatment's last replicate stay in any case.

## The sheet

`get-experiment` reads the experiment's sheet, and `get-unit` one unit's row of it. The sheet is the design and a cell for every unit on every observation, each cell resolved as the analysis reads it (see [readings](readings.md)):

- `reading` is the count the day uses for the unit and its `source`: `manual` for a count a person entered, else `review`, `proposal`, or `detection` for the best reading its photograph has. It is null while the cell has no number: no photograph or count yet, a photograph not yet read, or a count that left a class the day counts unanswered.
- `exclusion` says why the day stays out of the analysis, or is null when it is in: an `event` names the culture event that took the unit out, and `unclear` says a photograph of the unit was marked unclear in an experiment that does not count such photographs. A reading may be present on an excluded day; the analysis does not use it, and a sheet exported from the workbench writes the reason in its place.
- `image` is the photograph behind the cell: its observation image `id`, which datasets add it by; its `digest`, which marks and dataset removal address it by; its analysis `state`; the three tallies it may carry; and whether it is `unclear`.
- `manual` is the count a person entered: its `tally` by class and when it was recorded.

A cell with neither reading nor exclusion has nothing yet. An agent reads numbers from the sheet; it never ranks a photograph's readings against an entered count or applies the exclusion rules itself.

Under the cells, `summary` is the experiment by treatment, taken from those same cells: `baseline` names the first observation, and `cells` holds one entry per treatment per observation with the `units` in the analysis that day, each with its `count` and its `rate`, the count over the same unit's count on the baseline, and the `count` and `rate` statistics over them: `n`, `mean`, and the sample `sd` and `se`, null for a single unit. A rate is null for the baseline itself, for a day read for another model, and for a unit that counted nothing on the baseline. An agent reporting a treatment's mean reads it here rather than averaging cells itself, so its figure is the one the workbench and the spreadsheet show.

## Entering a day

A day enters as an observation and the records taken on it, by either or both of two ways: photographs the workbench reads, and counts a person took at the bench.

1. `get-experiment` reads the sheet: treatments, units with their codes, and the observations already made.
2. `create-observation` adds the observation date, the recognition task its photographs are read for, and `countedClasses`, the classes the day's count sums, every class when omitted; a germination trial's later days count `["germinated"]`. When the photographs are already uploaded, `images` matches them to their units in the same step, so the day and its photographs enter together or not at all; omit it to plan a day first.
3. `POST /api/agent/images` stores each photo and returns its digest. `assign-images-to-observation` matches digests to units in an observation that already exists, keeping each source filename for traceability; a unit already photographed that day is given the new one. Filenames may suggest unit codes, but the unit id in the assignment is authoritative.
4. `enter-manual-readings` enters the counts people took by hand on one observation, a tally per unit naming every class the day counts, such as the germinated seedlings counted while transplanting a dish that was never photographed. A unit's entered count outranks every reading of its photograph, so a dish counted at the bench reads by that count whatever the photograph says; a tally of `null` withdraws it. A class the day counts and the tally does not name is unanswered, not zero, and the call is refused, so an agent gives every class. A unit that left the bench before the observation cannot be counted.
5. A photograph that cannot be read clearly, a fogged lid or a dish out of focus, is marked unclear by digest with `mark-image-unclear` (`{"digest":"…"}`), or in the same step as its matching by giving the entry `"unclear": true`. The mark belongs to the image wherever it is observed. Whether it counts is each experiment's `countsUnclear`, false unless `create-experiment` or `update-experiment` sets it: where it is false, the unit leaves the analysis on every day, since the mark says the dish's record cannot be trusted, so the sheet marks every cell of the unit excluded, while the photograph is still read and shown; where it is true, the number is used as it stands. A day with no photograph excludes nothing: the unit only has no number that day, unless a count was entered for it. Datasets train on an unclear photograph like any other. `mark-image-unclear` answers `marked: false` when the photograph was already marked and `clear-image-unclear` answers `cleared: false` when there was no mark, so both are safe to repeat; a matching never clears a mark. None of these reads anything again.
6. `record-culture-events` records one event on the units it happened to at an observation. Contaminated, discarded, and missing take a unit out of the analysis from that observation on; nonviable and harvested keep it in, and discarded, harvested, and missing take it off the bench afterwards, so no later day of it can be photographed or counted. `delete-culture-event` erases an event recorded by mistake.

Analysis needs no request: matched photographs are queued for the current version of their observation's model automatically, and `retry-observation-image-analysis` requeues one that failed. A trained version is a candidate until a person makes it current on the model's page; agents do not choose versions. A model with no current version queues nothing; its photographs wait for a reviewer, and `create-model` names such a model in the first place.

## Training-set workflow

Photographs that a reviewer has annotated become training material once they belong to a dataset for their observation's model:

1. `get-experiment` reads the sheet; each cell's `image` carries the observation image `id` that names the photograph.
2. `list-datasets` shows the datasets for a model by id and name, with how many images each holds and how many are reviewed. Training uses only reviewed images.
3. `create-dataset` names a new, empty dataset for a model. The name is unique whatever its case and stays filename-safe, because transfer and `vitroctl` data roots know a dataset by name; `update-dataset` renames it later without touching its images, splits, snapshots, or runs. Every other dataset tool addresses the dataset by its id.
4. `add-images-to-dataset` adds observation images to a dataset. One call takes images observed for the dataset's model; images already in the dataset are counted as `existing`, so repeating a call is safe.
5. `get-dataset` lists a dataset's images by digest, each with whether it is reviewed, whether a person marked it `unclear`, and its training split; the digests match the photographs in the sheet's cells.
6. `remove-images-from-dataset` takes images out by digest, for example a blurred photo or a unit found contaminated. The images and their reviews remain, and snapshots already taken keep what they froze; digests not in the dataset are counted as `absent`, so repeating a call is safe.

The train/validation split is not chosen here: a training snapshot gives each reviewed image a split it keeps from then on.

## Transactions

A command runs in one database transaction: it either changes the record as a whole or leaves it untouched. A call that enters several units' counts, records an event on several units, moves several units, or creates a day with its photographs therefore lands whole or not at all. Image upload only stages immutable content by digest; matching that content to an observation is the command that changes the record.

## Inference task control

`get-inference-task` accepts `{ "versionId": "<model-version>", "digest": "<image-sha256>" }` and returns the durable task and its execution attempts, or null when no task has been materialized. Each attempt records its Worker, session, execution deadline, lease, final state and failure. `retry-inference-task` accepts the same target and resets a terminal failure's retry budget while retaining its attempt history. Successful results remain immutable. Experiment image reviews use the same retry operation internally.
