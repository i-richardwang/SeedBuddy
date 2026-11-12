# Architecture

SeedBuddy has a workbench and two Python packages: `seedctl` (`src/seedctl`) runs Worker processes, moves datasets and trains detectors for operators, and `seedbuddy` (`packages/seedbuddy`) prepares photographs for experimenters. Source boundaries describe the capabilities a module may use; each boundary is organized by the domain or lifecycle it owns. React components can render on the server, so a frontend directory does not authorize browser globals during rendering.

## Web boundaries

`domain/` and `lib/` do not import React, localization, frontend features, or server implementations, and do not access browser-only globals. Domain modules may use library utilities; libraries do not depend on domain modules. Domain schemas and transformations can be used directly by services, contract generation, or frontend features.

`features/` owns browser requests, form state, and interaction lifetimes. `ui/` may use domain types and display them, but never invokes a feature or Server Function. For example, the shell receives the signed-in account control as content; the account feature owns sign-out. File routes assemble these pieces. Both Server Functions and file-route HTTP handlers are valid service entry points.

The server module map and transaction rules are described in [Backend architecture](backend-architecture.md). Vite protects `web/src/server/` and `web/src/server.ts` from client imports. `bun run architecture:check` additionally checks layer directions, pure-module capabilities, test isolation, all source-file cycles, and server public APIs. Service public entries expose only consumed names; namespace and dynamic consumers are retained conservatively. Operation-owned command handlers must reference their executor parameter. Imports, type imports, and re-exports participate in the rules. Dynamic imports must use literal paths.

## Shared contracts and validation

`domain/datasets/archive-format.ts` owns archive entry names and limits. `features/datasets/import-archive.ts` reads a browser archive, checks the destination, uploads its images, and applies the manifest. Services import the format without importing the browser workflow.

Image admission returns stable refusal codes. Training parameters, annotation configuration, and inference model manifests use authoritative Zod schemas. Forms derive bounds from those schemas and own only labels and interaction steps. The [wire contract boundary](backend-architecture.md#wire-contracts) defines Python validation.

Domain exceptions inherit shared categories from `domain/errors.ts` and carry stable codes. The Server Function boundary converts expected refusals to an explicit `business_failure` document containing its code, category, and declared JSON details. The UI validates and translates that document. Diagnostic messages remain English, and unexpected exceptions are logged and passed to the framework's error handling. HTTP and MCP adapters retain their explicit protocol mappings.

## Annotation lifetime

`features/annotation/ImageWorkbench.tsx` owns one `Workbench` and one `ImageViewport`. The image's boxes are a draft from the first frame, and the same viewport stays mounted through edits, saves and conflicts. The edit lock gates changes to that draft; the viewport keeps one mode. `features/annotation/lock.ts` holds process-global state outside the draft session: each page load begins locked, and unlocking persists from image to image until reload. Display layers, manual zoom, and pan survive all of them. The viewport shows the image's preview from its first frame and lays the image itself over it once that has arrived.

`domain/annotation/draft.ts` owns the pure annotation draft, undo/redo, and the submission freeze; `features/annotation/session.ts` opens it from the page's annotations. The draft begins from the annotation layer on view (review, AI proposal, or detections) and its base is the stored review the page loaded, or null for an unreviewed image. While nothing has been edited it follows the annotations as they refresh; once edited it holds, and showing another annotation layer over the edits begins again from it as an undoable step. The save sends the base with the boxes, so a review changed elsewhere is refused and the draft stays open until its edits are dropped and the annotations read again. The primary command stores the boxes on view and the page stays on the image: it reads Save over edits and Confirm over an automated annotation taken as it is, and Mod+S does the same. On a reviewed image it leads to the next one still to review, so storing and moving on are two presses of Enter. The DOM lifecycle test pans and zooms, edits, confirms, and meets a conflict, and verifies the original image node and its transform remain intact throughout.

## Python boundaries

`image_geometry` owns dish circle detection and the pixel window a frozen dish coverage frames, without model or annotation dependencies; traditional detection uses the former, YOLO export and inference the latter, and the workbench reads the same [recipe](images.md) to bound AI annotation to the dish. AI annotation itself runs on the workbench and the agents people connect to it; see [AI annotation](ai-annotation.md).

`seedbuddy` depends on neither `seedctl` nor the workbench. It ships its own `dish-recipe.json` as package data. A test pins those bytes to `src/seedctl/image_geometry/dish-recipe.json`; its independent detector reads that recipe and uses the same half-up thumbnail dimension rule as `image_geometry/recipe.py`.

The allowed internal dependencies are defined by layer:

| Layer | May depend on |
| --- | --- |
| `contracts` | None |
| `io` | None |
| `detector_contracts` | `contracts` |
| `image_geometry` | `contracts` |
| `datasets` | `contracts`, `detector_contracts`, `io` |
| `training` | `contracts` |
| `traditional` | `contracts`, `datasets`, `detector_contracts`, `image_geometry`, `io` |
| `ultralytics` | `contracts`, `datasets`, `detector_contracts`, `image_geometry`, `io` |
| `worker` | `contracts`, `detector_contracts`, `io`, `models`, `traditional`, `training`, `ultralytics` |
| `host` | `io`, `worker` |
| `models` | `contracts`, `io` |
| `cli` | `contracts`, `datasets`, `host`, `io`, `models`, `traditional`, `training`, `ultralytics` |
| `entry` | None |

`detector_contracts` owns the `detectors` namespace outside its algorithm families. `host` owns `worker/host` and depends on the `worker` package layer. `entry` is the top-level package. `DatasetManifest.annotated` in `datasets/manifest.py` filters the manifest to reviewed images. Traditional configuration defaults are `DEFAULT_PIPELINE_CONFIG` in `detectors/traditional/config.py`; candidate training uses `_DEFAULT_GRID` in `detectors/traditional/training/training.py` unless its caller supplies a `SelectionGrid`; split assignment belongs to `detectors/ultralytics/dataset.py`, which defines `assign_splits` without exporting it from the package.

`scripts/check_architecture.py` defines these layer names and checks ownership, dependency directions, unresolved package imports and cycles, including type-only and function-local imports.

## Execution identity

Traditional execution identity lives in `detectors/traditional/identity.py`. Its source fingerprint includes the pipeline's behavior dependencies, including image decoding in `io/image_io.py`. The detector runtime fingerprint also includes its adapter, common detector contract and annotation validator. The Ultralytics runtime fingerprint hashes its installed framework version with those three source files. Source paths are explicit and resolved relative to their owning implementation. Digest helpers in `io/files.py` are outside the pipeline fingerprint inventory.

A runtime fingerprint identifies execution code. A traditional artifact digest identifies the candidate model and configuration. Model Bundle version identity is defined in the [operator guide](seedctl.md#training-and-model-delivery). Regression tests check this distinction by varying behavior-source and dish-recipe bytes. An import-closure check requires traditional and image-geometry algorithm modules reachable from the pipeline to remain in the fingerprint inventory.

## Database schema

Startup applies all forward migrations in `web/drizzle/` through the [database preparation chain](backend-architecture.md#persistence-and-startup). The schema describes the records, and applied migrations are immutable. Tests cover empty database initialization and populated records.

## Verification and test locations

The `Quality` workflow runs the [verification gate](../README.md#verification) on pull requests and main-branch pushes with locked dependencies, then checks PostgreSQL concurrency and S3 immutability against disposable storage. The workflow exposes a `check` job for branch protection. Private reference images are an explicit operator check.

Authentication tests live in `web/src/server/auth/service.test.ts`, Worker HTTP tests in `web/src/server/transport/http/worker.test.ts`, and database constraint tests in `web/src/server/infra/db/schema.test.ts`.

The Python Ultralytics tests use the `tests/test_yolo_*` family.
