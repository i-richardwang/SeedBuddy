# Readings

An experiment reads its photographs as numbers: how many individuals a unit
holds on a given day. This document defines where each part of that reading
lives.

## What a model declares

A model declares the classes it recognizes and nothing else. Classes are the
model's identity: the image page offers them as the class of a box being drawn, the
YOLO export indexes labels by them, dataset transfer requires both ends to
agree on them, and a training snapshot freezes them alongside the images.

The built-in `seed-detector` recognizes `ungerminated` and
`germinated`, two states of one seed. Every visible seed is boxed in one of
them, so a photograph annotated for it teaches the model both what a seed is
and which state it is in. Seeds hidden under grown seedlings go unboxed, since
nothing in the photograph shows them.

A model can exist without a version; its images can still carry reviews and AI proposals. Version behavior follows the [model lifecycle](domain.md#models-and-versions).

## What an observation declares

An observation declares the date it was made, the model its photographs are
read for, and which of that model's classes the day counts. Which version has
read an image is recorded with that image's detection, and the version that
reads for a model follows the [model lifecycle](domain.md#models-and-versions).

What a day counts is the experiment's question, not the model's. A germination
trial photographs its dishes before anything has germinated and counts every
seed, `ungerminated` and `germinated` alike; later days count `germinated`
alone, since grown seedlings hide the seeds that have not germinated and the
photograph does not show them all. A day counts every class its model
recognizes unless it names fewer, and it always counts at least one.

## Where the numbers come from

What an experiment needs of a unit on a day is a number: how many
individuals of each class it held. A photograph is one way to get it, and
the usual one; a person counting the dish at the bench is another. Where the
number came from is kept beside it, and the number enters the statistics.

A cell is one unit on one day. It holds the photograph taken of the unit
that day, if one was, and the count entered by hand for it, if one was;
it exists once it has either. One unit has at most one photograph and one
count entered by hand per day.

Every photograph yields a tally: how many instances of each class the reading
found. An image can hold three readings, and they rank: a reviewer's
review outranks an AI agent's proposal, which outranks the model’s
detection. Only a review marks the image reviewed; the grid distinguishes it from automated readings. The grid and resolved sheet use detections from the current model version. The image review workbench can display the newest version that has detected the image while the current version’s result is pending; that displayed fallback does not become the grid’s detection.

A count entered by hand is a tally too, kept by class, for a day that was
not photographed or a dish that was counted at the bench, such as when its
seedlings were moved. It is entered for a whole observation at a time, a row
per unit and a field per class the day counts. When it supplies every counted class, it takes precedence over the photograph. The grid marks it as a count entered by hand. Counts and observation edits follow the [record lifetime rules](domain.md#experimental-design).

A photograph's tally leaves out a class it found none of, and that class
counts zero. A person's count may not: a class the day counts and the count
never gave is unanswered, not zero, so the count must give every class the
day counts, and if the day later comes to count a class the count did not
give, the cell reads from its photograph instead, or has no number.

A count is how many instances of the classes its day counts a unit's
reading found. The tally keeps every class whatever the day counts, so changing
the classes recounts the same readings, and nothing is read again.

## What the grid shows

A row is a unit, beside the treatment it belongs to. A column is the day. Under
the date it names the model only when the days do not all read for the same
one, and the classes it counts only when they are fewer than its model
recognizes. A cell shows the unit's count. A count a person stands behind,
by reviewing the photograph or by entering it, is shown plain, one nobody
has reviewed yet provisional, and one entered by hand carries a small mark.
A day out of the statistics is struck through, and an unclear photograph
carries a small mark whether or not it counts, so a unit struck through for
one shows which. Hovering says why. A photograph not yet read appears as a photograph; a unit without a photograph or count entered by hand shows no value. A failed image reading is marked.

## What the spreadsheet carries

The experiment page's **Export spreadsheet** command downloads an `.xlsx` file of two sheets: the grid, and the summary of it
by treatment. The grid's block at the top names the experiment,
its plant material, explant type and base medium, the day it was inoculated and
the day the file was taken. Below that the design repeats down every row —
treatment, factor, unit — so the table sorts, filters and pivots on it, and each
observation heads the column of counts it read, one row per unit. Under its date
a day names its model, and the classes it counts when they are fewer than the
model recognizes.

Quantities stay quantities and days stay days. A count is a number whoever
stood behind it, and a day is the day a spreadsheet counts rather than the
text of one, so whatever opens the file can sort, chart and compute on it.
The sheet records what the dish did rather than what the workbench is doing:
a reading still to come, or a day with neither photograph nor count, leaves
its cell empty, and a day out of the statistics carries why in place of its
number: the name of the event that took it out, or else the word for
unclear.

## What an agent reads

An agent reads the experiment as a sheet (`domain/experiments/sheet.ts`): the
design, a cell for every unit on every observation, and the summary by
treatment. Each cell is resolved here, by the same functions the grid and the
spreadsheet use: the reading counted in the statistics and who stood behind it, why
the day is out of the statistics if it is, and under them the photograph and the
count entered by hand the reading came from. An agent therefore never ranks readings,
applies the exclusion rules, or averages a treatment itself, and a change to
any of them changes what every reader sees at once. The workbench grid is a
different view: it also shows what the workbench is still doing with a
photograph, which the sheet does not.

## What the summary says

The summary (`domain/experiments/summary.ts`) is the experiment by treatment:
on each observation, how many of a treatment's units have a number in the
statistics, the mean of those numbers, and their spread as the sample standard
deviation and standard error. The unit is the replicate, so the statistics are
taken over units and never over the individuals they hold: three dishes give
n = 3 whatever they were sown with. A single unit has a mean and no spread,
and a unit out of the statistics that day is not among the n.

Two numbers are summarised. The count is what the unit read that day. The
rate is that count over the unit's own count on the first observation, the
day everything sown was counted: a germination trial's rate is the seeds
germinated over the seeds sown in the same dish, and the treatment's rate is
the mean of its dishes' rates, not the germinated over the sown of all of
them together. A rate exists where the day reads for the model the first
observation read for and the unit counted something that first day; the
first observation itself has none, and a day read for another model has
counts alone. A day is read by its rate where any treatment has one, and by
its count otherwise.

The [experiment page](interface.md#pages) presents the summary. The spreadsheet carries it as its second sheet, with n, mean, SD and SE under each date; the agent’s sheet carries it under the cells. Whether the
treatments differ significantly is a question the summary does not answer:
the test and the multiple-comparison method are the researcher's to choose,
so that work is done on the exported numbers.

## What takes a unit out of the statistics

A unit out of the statistics on a day contributes to no treatment summary that
day, and no day comparison measures a change across it. Two things take a
unit out.

A culture event takes it out from the observation that records it:
contaminated, discarded, and missing do. Nonviable does not. Harvested keeps
it included on the recorded observation and excludes it from later ones, when
the unit has left the bench. What came before the event still happened, so
the earlier days stand.

An unclear photograph is one a person could not read clearly, a fogged lid
or a dish out of focus. The mark is the image's, wherever it is shown.
Whether an unclear photograph counts is each experiment's setting, and it does
not unless someone turns the setting on. Where it does not, the photograph
takes its whole unit out, every day of it: marking it says the dish's record
cannot be trusted, and that is said of the dish, not of one day. Only a
photograph on a day the unit's events still keep in can do so; a dish already
contaminated is out from that day on whatever is photographed later. A day an
event takes out names the event. Where unclear photographs count, the number
is used as it stands. Either way the photograph is still read and shown, and
datasets train on it.

A day with neither photograph nor count entered by hand takes nothing out: the unit
has no number that day, and its other days count as they are.

Marking, clearing, recording an event or changing the setting reads nothing
again; it only changes what counts.
