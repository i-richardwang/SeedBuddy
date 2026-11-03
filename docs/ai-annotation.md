# AI annotation

VitroFlow serves visual annotation through its own MCP server,
`/api/annotation/mcp`, separate from the experiment MCP server at `/api/experiments/mcp`
(see [Agent API](agent-api.md)). An agent is configured with the server its job
needs: one that annotates images connects here, one that maintains experiments
connects there, and each is authorized on its own. VitroFlow supplies images
waiting for annotation, regional evidence and validation; the connected agent
supplies visual reasoning.

## Product workflow

The [reading rules](readings.md#where-the-numbers-come-from) define how an AI proposal contributes to counts and human review.

A run has two inputs besides the image. Its input is the boxes it begins
from: none, so the agent draws from clean pixels, or a set of boxes it refits.
Its scope is the part of the image it redraws: the whole image, or only the
regions some source-pixel boxes touch, in which case every other region keeps
its input boxes. When beginning from an AI proposal, untouched regions also keep
which of their boxes await confirmation. The touched regions are replaced in full,
including that mark. Model settings own classes, instructions, region
geometry and the annotation area (`image` or `dish`). The server freezes these
settings and the resulting coverage at creation. Seed detection defaults to
`dish`; other models default to `image`.

An agent a person connects to the annotation server, such as Claude Code or
Codex, finds the images waiting for it and annotates them from its own
conversation, many regions per conversation. Pages show its run's progress and
the AI proposal it leaves; only a person writes an accepted review.

An image and model have at most one run in progress, so the image is the run's
address. Accepted regions are durable, and the run stays open until every region
is accepted or an agent cancels it to start again differently. Any connected
agent, in any conversation, continues it from the first region still waiting.

## Authorization

A person's agent authenticates with user OAuth for the annotation resource, or
with a personal API key that holds the Image annotation scope, presented as
a bearer token. The annotation server carries no experiment or model tools, and
the experiment server accepts neither OAuth tokens bound to the annotation
resource nor keys issued for annotation alone.

OAuth discovery and connection behavior follow the [shared MCP contract](agent-api.md#mcp-surface). For annotation, the protected resource metadata is `/.well-known/oauth-protected-resource/api/annotation/mcp` and the token audience is `<BETTER_AUTH_URL>/api/annotation/mcp`.

Add the annotation server to a local client:

```bash
claude mcp add --transport http vitroflow-annotation 'https://<workbench>/api/annotation/mcp'
codex mcp add vitroflow-annotation --url 'https://<workbench>/api/annotation/mcp'
```

## Tool contract

`annotation-find({image})` finds image references by filename or workbench page URL and lists their experiment or dataset locations. Ambiguous matches are presented for selection.

`annotation-pending({modelId?})` lists the images in datasets and experiment
observations waiting for an agent. Images with a run in progress come first, with
its progress, to be continued with `annotation-next`. Then come those that have
neither a reviewer's boxes nor an AI proposal for their model, provided the model
has annotation instructions. `modelId` narrows the listing to one model; a
listing names at most 100 images and reports how many wait in all.

`annotation-read({ref: {digest, modelId}})` returns how the image is annotated
for the model at the time of the call: the reviewer's boxes, the AI proposal and the detection
as source-coordinate instances, which of them the image reads by, and any run
still at work. It is the view to consult before redrawing part of an image.

`annotation-start({ref: {digest, modelId}, input?, scope?})` starts the image's
run. `input` is the boxes the run begins from: a complete
source-coordinate list, the name of one of the image's annotation layers (`"review"`,
`"proposal"` or `"detection"`, as `annotation-read` lists them) taken as it stands
when the run starts, or nothing to start from the image alone. Naming an
annotation layer the image lacks is refused. `scope` is an optional list of
source-coordinate boxes `{x, y, width, height}` with the [whole-region redraw semantics](#product-workflow). A scoped run requires
`input`, and a scope touching no region or leaving the image is refused. While the
image has a run in progress, starting another is refused with that run's progress.

`annotation-next({ref})` returns progress and the `taskId` of the first region of
the image's run still waiting for an answer. It returns the same region until that
region is accepted.
It is refused when the image has no run in progress.

`annotation-cancel({ref})` cancels the image's run in progress and discards its
accepted regions, so another run can start with another input or scope.

Each region is then worked through four tools:

- `annotation-context({taskId})` returns a stable `contextId`, the frozen image,
  classes, rules, layout, scope and frozen coverage, and one unmarked whole-image OVERVIEW.
  `contextId` is the run identity: its definition is frozen, so every region of
  that run uses the same context. Load it at conversation start, when the context
  changes, and after context loss or compaction. A client may explicitly reload
  it at any time; the server does not track which conversations have seen it.
- `annotation-view({taskId})` returns `contextId`, regional source geometry,
  CLEAN, and optional numbered INITIAL references. It does not repeat the
  overview or shared rules. Core and patch rectangles are original image pixels;
  proposal coordinates remain normalized to CLEAN. Task identifiers are
  server-issued and must be used verbatim.
- `annotation-preview({taskId, instances})` validates the complete proposal,
  stores an immutable version, and returns `proposalId`, CLEAN and PROPOSED images.
  Instances have `id`, `class`, `box_2d`, and an optional `uncertain`
  flag. Where the image leaves a body's class, outline or count undecided, the
  agent draws its most likely annotation and marks those boxes `uncertain`; a person
  confirms them on the canvas, where each is ringed. A doubt never stays without
  a box, so a person only ever confirms or corrects a concrete answer.
  Coordinates are `[ymin, xmin, ymax, xmax]`, normalized to 0–1000 relative to CLEAN.
  Preparation validates the response and projects its owned boxes into source
  coordinates for rendering. The immutable response is the content accepted by
  submission and projected into the final image. PROPOSED
  shows only the boxes this region owns and will save; halo-only boxes belong to
  neighboring regions. Boxes are outlined in their class's color, and a model
  with several classes labels each box with its class and names the colors. Preview and final collection use the same projection.
- `annotation-submit({taskId, proposalId})` durably accepts exactly the previewed
  proposal. Changed geometry requires another preview. Empty regions still submit an
  empty instance list. The final accepted region automatically completes the run.

## Evidence and caches

Images are MCP image content containing PNG bytes, not authenticated download URLs.
A hosted client must expose MCP image content to its visual model to inspect this evidence; a text-only tool renderer cannot perform the visual workflow. Only the service reads canonical AVIFs from the blob store. The default
512-pixel core, 32-pixel halo and 1× display preserve native region detail; the
shared overview is limited to a 1024-pixel longest side. Display magnification
changes presentation, not final coordinates. Runs are limited to 4096 regions;
increase core size for larger images.

The image asset module prepares regional evidence on first access in both
annotation area modes, outside database transactions. A cold preparation decodes
the canonical AVIF once and uses those pixels for lossless PNG regions and an
unmarked base overview. A scoped or dish run prepares only the regions it assigns;
their assets are shared with whole-image runs. Region geometry is shared with task
planning; rules, initial boxes and proposals are not part of the image assets.
The source digest, core size, halo, display scale and renderer version identify
reusable assets in the blob store, including after a server restart.
A completion receipt identifies an asset plan. Incomplete preparations reuse
finished images and resume the same preparation path.

Regional preparation follows the shared [image processing budget](images.md#previews-and-processing). A 32 MiB LRU retains encoded
evidence, not decoded originals. Context reads the overview; views and previews
read CLEAN. Reference and proposal overlays use a separate 16 MiB LRU and at most
two concurrent renders. Decoder and render working memory are additional to these
cache budgets. The run's state is checked even on cache hits.
Collection removes derived assets when their source Image is unreferenced.

## Dish coverage

A dish run covers the dish its image's stored [analysis](images.md) found.
Coverage expands the detected radius by 15%. A core is omitted only when its
rectangle is wholly outside that coverage; crossing and tangent cores remain.
Grid IDs, patches, halos and box ownership stay unchanged. Evidence and boxes are
never masked or clipped to the circle. `scope` intersects coverage with the redraw regions. Progress counts assigned tasks. Cores outside dish coverage retain their input boxes as part of the unreviewed proposal, awaiting human confirmation; only input boxes already marked uncertain retain an uncertainty check.

Starting a run reads metadata in one transaction, freezes coverage and tasks, and
performs no image I/O, detection or PNG preparation. Missing, obsolete,
no-candidate or invalid-circle analysis keeps full-image coverage, and the start
logs its reason with the image and run IDs. Analysis refreshes and model settings
never alter a frozen run.

## Batch workflow

A conversation loops through next, view, preview and submit using the [context loading rules](#tool-contract). Context loading is read-only and does not advance the run.

For 20 fresh regions with one preview each, this flow delivers one overview,
20 CLEAN views and 40 preview images. This counts image messages, not model
tokens.

For seed annotation, use the [annotator](ai-annotation-prompts/annotator.md) and
[coordinator](ai-annotation-prompts/coordinator.md) templates. The templates define batch limits and subagent handoff. Initial annotation and maintenance
share this workflow, with different run inputs. Project criteria include user-confirmed
early plump germination. Annotators inspect previews themselves. Reading precedence follows the [reading rules](readings.md#where-the-numbers-come-from).

## Persistence and failure semantics

Tool handler failures and SDK argument validation follow the [shared MCP error contract](agent-api.md#error-contract).

Postgres is the single authority:

- `annotation_runs`: frozen input and scope, aggregate progress and final
  proposal.
- `annotation_tasks`: frozen core/patch geometry and accepted regional response.
- `annotation_previews`: immutable proposal versions of a region.

Rendering happens outside acceptance transactions. Short transactions serialize
run changes, validate geometry, accept a region and update progress. Concurrent
final submissions cannot complete a run twice. Source-coordinate boxes are owned
by the half-open core containing their centers. Neighbors read the same seam
object independently, so their centers can disagree; collection therefore reads
every region's boxes, halo context included, and treats boxes from different
regions overlapping by IoU ≥ 0.5 as one object, whatever class each region
judged it, at most one box per region, strongest overlaps first. Each object
yields one box, its class included: a retained input box first, then a box its
region owns, then a whole halo box over a cut one. A halo box its owning
region did not confirm is dropped. Seam collection treats frozen input under the [scope rules](#product-workflow) as retained boxes. Overlaps
within one region are never merged. Owned boxes touching internal patch edges
are rejected. A box's uncertainty is the agent's own judgment and stays with
the box chosen for its object. Frozen input uncertainty, when present, describes
the input proposal; bare boxes carry no such assessment. Geometry validation does not
establish visual accuracy.

A transport retry of an accepted proposal is idempotent. A cancelled run is not resumed; another run starts over.
