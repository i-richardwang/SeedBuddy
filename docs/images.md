# Images

Uploaded JPEG, PNG and TIFF images are normalized to oriented, opaque sRGB AVIF. Those bytes determine the digest, dimensions, browser view, inference input and training input. Every image is stored once under its digest. Ingestion also
finds the culture dish in it, so that work reading the image, such as
[AI annotation](ai-annotation.md), can be bounded to the dish.

## Dish analysis

Dish detection runs in one lazy compute thread per process using pinned OpenCV.js
4.12 WASM. Ingestion analyzes the final canonical AVIF bytes, including canonical
imports, and records completed analysis in `images.dish_analysis`. Only an RGB
thumbnail with longest edge at most 1200 pixels crosses the thread boundary.
Image encoding, digest and source coordinates remain unchanged. Canonicalization
and analysis are separate bounded operations; analysis reads the pixels of the
stored encoding.

Completed analysis stores its recipe identity and circle. A null circle means
successful analysis with no candidate; null analysis means unavailable. Repeated
uploads reuse current completed results.

One shared `src/vitroctl/image_geometry/dish-recipe.json` supplies Hough parameters and coverage
policy to both runtimes, validated against the generated `dish-recipe` contract.
The server uses Sharp Lanczos3 and OpenCV.js; native Python uses OpenCV INTER_AREA.
They share parameters and half-up thumbnail dimensions, but can produce slightly
different circles. Radius validation allows one thumbnail pixel of tolerance
around the integer Hough bounds.

The server's analysis identity contains detection parameters, preprocessing and
one explicit implementation revision. The shared JSON stores parameters without a
separate version number, so parameter changes alter the identity automatically.
Dependency version inventories and the coverage margin are excluded. Behavior changes outside detection parameters change the implementation revision; dependency versions alone do not change the analysis identity.

## Maintenance

The maintenance process automatically refreshes unavailable or obsolete analysis.
It analyzes up to two images serially, then waits 30 seconds. Blob collection runs
on its own hourly cadence; infrastructure failures back off for one minute without
stopping the other responsibility. Maintenance uses one Sharp processing thread
and its own compute runtime, so its resource budget is separate from the
workbench's. Compose and the Zeabur template include this process as an
application service. Built command entry points are listed in [Backend architecture](backend-architecture.md#persistence-and-startup).

Deployment roles are described in the [deployment guide](../README.md#deployment).

`images.dish_analysis_attempted_at` durably records each analysis attempt.
Maintenance prioritizes never-attempted images, then the oldest eligible attempts,
with a 15-minute retry interval. Each claim commits in a short transaction using
[`FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE);
decoding holds no database locks. Result writes are fenced by the attempt
timestamp and cannot replace newer analysis. Missing or corrupt images fail
individually and do not block later images. Database and object-store transport
failures reach infrastructure backoff. Completed no-candidate results are not
retried. Shutdown finishes the current image before stopping.

After `bun run build` in `web/`, `bun run images:analyze [batch-size]` executes `dist/analyze-images.js` for a finite sweep. The optional positional batch size defaults to 100 (maximum 1000).
A fixed attempt cutoff excludes every image tried during the sweep, even if a
long sweep outlasts its retry interval. Recent attempts remain in cooldown. The
command reports examined, completed, failed and skipped counts. Completed means
analysis was persisted; skipped means a newer result or image deletion made the
write unnecessary. Every attempt satisfies
`examined = completed + failed + skipped`. Image failures or interruption produce
a nonzero exit status; skipped results do not. It uses the same canonical pixels
and detector as ingestion. Maintenance keeps the corpus current on its own; a
manual sweep is for refreshing it at once.

## Previews and processing

`images/preview.ts` derives a small rendition after ingestion or on a read that finds it missing. Collection removes it with the source image. `images/processing.ts` admits one large-image operation per process across ingestion, analysis and regional preparation; encoded caches are bounded and contain no annotation or model state.
