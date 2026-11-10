# Records, models and datasets

The [reading rules](readings.md) define counts, exclusions, summaries and exports.

## Terms

A reading is a count for a unit and observation, read from a photograph by a model or a person or entered by hand; a detection is a model’s reading.

A Worker is a enrolled machine. A Worker process is the running program that authenticates as that Worker and supervises execution.

API key scope names follow the UI: Dataset transfer, Experiment records and Image annotation.

## Experimental design

An experiment has a case-insensitively unique name, plant material, explant type, shared base medium, protocol notes and inoculation date. A treatment names a condition, optionally as a factor, level and unit written as applied. Shared conditions belong on the experiment.

A unit is an independent vessel receiving one treatment. The design begins with at least one treatment and one replicate per treatment, with suggested codes `T1-1` through `T1-n`. Codes are unique within an experiment. Correcting a code or moving a unit between treatments preserves its identity and records. Treatments can gain replicates; the last treatment and the last replicate cannot be removed or moved away.

An observation is one occasion on one calendar day, at most once per experiment per day, ordered by date and never before inoculation. It can be recorded before photographs arrive or together with photographs matched to units. Protocol fields, treatments, unit codes and observation dates are correctable within the recorded lifetimes.

At most one standardized photograph belongs to each unit and observation. Its source filename supplies a suggested unit code for confirmation and remains traceability metadata, not identity. Replacing or removing an assignment preserves the canonical image and its annotations. Objects within a unit are subsamples; the physical dish circle is an image diagnostic, not the unit's identity.

Images, counts entered by hand and culture events prevent deletion of their unit or observation, and prevent deletion of their treatment or experiment. Deleting an eligible treatment also deletes its units. An inoculation date cannot move past an observation. Discarded, harvested and missing are terminal culture events; a unit has at most one terminal event and has no records after it. An event entered by mistake can be removed. Correcting an observation date must preserve these lifetimes. An observation with counts entered by hand keeps its model until those counts are withdrawn; its counted classes can change within that model.

## Models and versions

Model identifiers are unique and classes are fixed at creation; only a release adds to the classes of a model it ships, after the ones the model had, and migrates the deployments that hold it. A version records the classes it finds, each one of its model's and in the model's order: every one of them, or fewer when it was made before the model declared the rest. Versions, observations, reviews, datasets and training runs prevent deletion of a model. The built-in `seed-detector` begins with `traditional-v1`, which finds seeds and labels them `ungerminated` for review.

A model's area says where in a photograph its task looks: `image` is the whole photograph, `dish` the culture dish its [analysis](images.md#dish-analysis) found, kept with a margin. The classes an observation counts unless it names its own, the area and the annotation instructions are the model's settings, editable on the Models page and through `update-model-settings`; `seed-detector` ships counting `ungerminated`, `germinated` and `dead` and as `dish`, a new model counting every class and as `image`. An observation keeps the classes it counts when the setting changes. The area governs what is created from now on and never what already exists: an AI annotation run freezes its coverage, a training snapshot freezes its classes, its area and each image's coverage, and a trained version records the classes it was trained to find and the frame it was trained on as its inference mode and reads in that mode whatever the model's area is set to since. A photograph whose analysis found no dish is used whole wherever a dish task meets it, and the fallback is logged.

Training publishes a candidate without selecting it. Candidate comparison uses the snapshot's held-out validation images, compares count error against reviewed counts per class and overall, and scores only images both versions have read. Selecting a version through the workbench or `use-model-version` reads the model's observations with that version. Returning to a version reuses its stored detections. Reviews and proposals belong to the image and model, so version selection leaves them intact.

## Dataset transfer

A dataset manifest carries image memberships, annotations for its model, unclear marks and informational detections. Every image entry requires an `unclear` boolean; omitting it makes the manifest invalid. Import requires a model that declares the manifest's classes in the manifest's order, all named images, an unused dataset name and no stored annotations for those images and that model. A manifest written before its model declared more classes still imports, and its annotations hold none of the classes added since. Import adds unclear marks without clearing them and does not import detections.

Download on the dataset page streams an uncompressed ZIP of its manifest and canonical images. Import on the model page uploads those bytes and applies the manifest. The archive uses the local data-root layout described in [vitroctl](vitroctl.md#datasets), so unpacking it yields a data root for one dataset. Transfer preserves image bytes and annotations.

A manifest holds at most 10,000 images and 16 MiB of JSON; each canonical image is at most 64 MiB. Only reviewed images enter training snapshots and YOLO exports. Removing an image from a dataset excludes it from subsequent training without deleting its review or altering frozen snapshots.
