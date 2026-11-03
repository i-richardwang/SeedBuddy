# Architecture

VitroFlow has a Web control plane and two Python packages: `vitroctl` (`src/vitroctl`) runs Workers, moves datasets and trains detectors for operators, and `vitroflow` (`packages/vitroflow`) prepares photographs for experimenters. Source boundaries describe the capabilities a module may use; each boundary is organized by the domain or lifecycle it owns. React components can render on the server, so a frontend directory does not authorize browser globals during rendering.

## Web boundaries

`domain/` and `lib/` do not import React, localization, frontend features, or server implementations, and do not access browser-only globals. Domain modules may use library utilities; libraries do not depend on domain modules. Domain schemas and transformations can be used directly by services, contract generation, or frontend features.

`features/` owns browser requests, form state, and interaction lifetimes. `ui/` may use domain types and display them, but never invokes a feature or Server Function. For example, the shell receives the signed-in account control as content; the account feature owns sign-out. File routes assemble these pieces. Both Server Functions and file-route HTTP handlers are valid service entry points.

The server module map and transaction rules are described in [Backend architecture](backend-architecture.md). Vite protects server files from client imports. `bun run architecture:check` additionally checks layer directions, pure-module capabilities, test isolation, all source-file cycles, and server public APIs. Service public entries expose only consumed names; namespace and dynamic consumers are retained conservatively. Operation-owned command handlers must reference their executor parameter. Imports, type imports, and re-exports participate in the rules. Dynamic imports must use literal paths.

## Shared rules and presentation

`domain/datasets/archive-format.ts` owns archive entry names and limits. `features/datasets/import-archive.ts` reads a browser archive, checks the destination, uploads its images, and applies the manifest. Services import the format without importing the browser workflow.

Image admission returns stable refusal codes. Training parameters, annotation configuration, and inference model manifests use authoritative Zod schemas. Forms derive bounds from those schemas and own only labels and interaction steps. Python validates against generated JSON Schema. Cross-field semantics remain with the domain that owns them.

Domain exceptions inherit shared categories from `domain/errors.ts` and carry stable codes. The Server Function boundary converts expected refusals to an explicit `business_failure` document containing its code, category, and declared JSON details; it does not rely on preserving an Error subclass across serialization. The UI validates and translates that document. Diagnostic messages remain English, and unexpected exceptions are logged and passed to the framework's error handling. HTTP and MCP adapters retain their explicit protocol mappings.

## Annotation lifetime

`features/annotation/ImageWorkbench.tsx` owns one `Workbench` and one `ImageViewport`. There is no separate editing mode: the image's boxes are a draft from the moment the page shows them, and the same viewport stays mounted through edits, saves and conflicts. Display layers, manual zoom, and pan survive all of them. The viewport shows the image's preview from its first frame and lays the image itself over it once that has arrived.

`domain/annotation/draft.ts` owns the pure annotation draft, undo/redo, and the submission freeze; `features/annotation/session.ts` opens it from the page's readings. The draft begins from the reading on view (review, AI proposal, or detections) and its base is the stored review the page loaded. While nothing has been edited it follows the readings as they refresh; once edited it holds, and showing another reading over the edits begins again from it as an undoable step. The save sends the base with the boxes, so a review changed elsewhere is refused and the draft stays open until its edits are dropped and the readings read again. The primary command stores the boxes on view and the page stays on the image: it reads Save over edits and Confirm over a machine's reading taken as it is, and Mod+S does the same. On a reviewed image it leads to the next one still to review, so storing and moving on are two presses of Enter. The DOM lifecycle test pans and zooms, edits, confirms, and meets a conflict, and verifies the original image node and its transform remain intact throughout.

## Python boundaries

`image_geometry` owns dish circle detection without model or annotation dependencies; traditional detection uses it, and the workbench reads the same [recipe](images.md) to bound AI annotation to the dish. AI annotation itself runs on the workbench and the agents people connect to it; see [AI annotation](ai-annotation.md).

`vitroflow` depends on neither `vitroctl` nor the workbench. It locates the dish with its own detector because it only needs a region to look in, not the reproducible analysis the workbench records for every stored image.

Worker execution can use algorithms and data documents. Algorithm families do not import workers or host operations. Dataset manifests depend on the detector contract, not an algorithm implementation; loading reviewed dataset entries belongs to `datasets/annotations.py`. Core annotation documents do not load datasets. The top-level package and detector namespace do not eagerly initialize algorithms.

`python scripts/check_architecture.py` checks package ownership, dependency directions, unresolved package imports, and file/package cycles, including type-only and function-local imports. It is part of `make check-python`.

## Execution identity

Traditional execution identity lives in `detectors/traditional/identity.py`. Its source fingerprint includes the pipeline's behavior dependencies, including image decoding in `io/image_io.py`. The detector runtime fingerprint also includes its adapter and common contract. Source paths are explicit and resolved relative to their owning implementation; moving a dependency does not justify dropping it from coverage.

A runtime fingerprint identifies execution code. A traditional artifact digest identifies the candidate model and configuration. The built-in model version ID is `traditional-v1`, and a trained one is the ID of the run that produced it. These identities have different purposes: a source change can change runtime identity without changing the artifact or inventing another model version. Regression tests check this distinction by varying behavior-source and dish-recipe bytes. An import-closure check requires traditional and image-geometry algorithm modules reachable from the pipeline to remain in the fingerprint inventory.

## Verification

`make check` runs Web builds, architecture checks, contract generation checks, formatting, type checks, and tests for the Web application and both Python packages. The standard suite uses PGlite and in-memory blobs. PostgreSQL, S3, and private reference images have explicit integration targets in the Makefile. Package moves must preserve CLI entry points, bundled data resources, and executable runtime fingerprints as well as import resolution.

The `Quality` workflow runs `make check` on pull requests and main-branch pushes with locked dependencies, then verifies PostgreSQL concurrency and S3 immutability against disposable storage. Repository branch protection must require its `check` job to make it a merge requirement. Private reference images remain an explicit operator check.

Database evolution uses forward migrations: the schema describes current records, while applied migrations remain immutable upgrade instructions. Tests cover both new database initialization and upgrades of populated records when a migration removes a field.
