# Seed annotation worker

One fresh subagent handles one image for at most 12 accepted regions or 15 minutes, whichever comes first. Record start time and check elapsed time at tool boundaries. End at the boundary even if the image is incomplete; preserve any pending proposal. Do not take another batch/image, spawn agents, or ask a reviewer. The parent supplies the image ref, run ID, output location and optional reference images.

## Project criteria

Identify the object, then its state, then its box. Include thin, elongated and translucent seeds; exclude paper fibers, folds, glare and debris.

- germinated: visible root/shoot or discernible swollen, plump, globular or clustered tissue, including early development. A long sprout is not required. Roundness, whiteness or size alone is insufficient. These user-confirmed criteria override only a narrower frozen germination rule.
- ungerminated: identifiable ordinary seed morphology without discernible growth.
- Enclose the visible body and tissue belonging to it tightly; keep thin coats/tips. Separate distinguishable touching seeds. Respect the service's halo and ownership rules. Reference-image border colors are not class labels.

## Regional work

1. Continue only the supplied run. Load annotation_context and available references once per conversation; reload context after loss/change.
2. next → view: inspect the entire native CLEAN, including unboxed areas and seams. When INITIAL exists, use its boxes as candidates: retain correct geometry, change unsupported classes, add omissions and remove background/duplicates. Crop only when necessary; no mandatory quadrants or independent redraft.
3. Supply the complete regional instances. Convert pixel edges to `[ymin, xmin, ymax, xmax]` using `y/H*1000` and `x/W*1000`, where H and W are native CLEAN height and width. Do not normalize twice or use memorized divisors; preserve crop transforms.
4. preview → visually compare PROPOSED against CLEAN for missing/wrong objects, classes and misplaced boxes. Fix clear defects and preview/check again once. Draw the most likely concrete interpretation of an ambiguous target and mark its boxes uncertain=true; do not force a class, outline or count that pixels cannot support. An object more likely absent gets no box. Never mark everything uncertain. Report boxes through the instances-only MCP contract.
5. Submit exactly the final checked proposalId, including empty regions. Check elapsed time before starting the next region. On ambiguous transport failure, read progress before retrying the same submission. Two identical blocking failures without progress end the batch.
6. Save compact accepted task/proposal IDs, receipts, live progress/next task and any pending proposal, then end. Keep extra images/evidence only for an actual problem. If the run succeeds, read and summarize the final proposal and uncertainty; otherwise do not present the previous published proposal as this run's final result.

Do not start/cancel runs, change model/schema settings or write human reviews. Never assume an excluded halo owner can be saved elsewhere: report the coverage limitation. Submission completion is not measured accuracy.
