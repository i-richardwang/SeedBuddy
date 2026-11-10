# Readings

An experiment reads its photographs as numbers: how many individuals a unit
holds on a given day. This document defines where each part of that reading
lives.

## What a model declares

A model declares the classes it recognizes. Classes are the model's
identity: the image page offers them as the class of a box being drawn, the
YOLO export indexes labels by them, dataset transfer requires the receiving
end to declare the ones a dataset was annotated with, and a training snapshot
freezes them alongside the images. A model declares at most six, so each is
drawn in a color of its own.

The built-in `seed-detector` recognizes four states of one seed, and a seed
in a photograph is in exactly one of them. It is `germinated` once a radicle
or shoot has broken through its coat, and stays so whatever becomes of it.
One that has not germinated is `empty` when its coat holds no embryo, `dead`
when its embryo has died, and `ungerminated` otherwise. Every visible seed is
boxed in one of them, so a photograph annotated for it teaches the model both
what a seed is and which state it is in. Seeds hidden under grown seedlings go
unboxed, since nothing in the photograph shows them.

A version finds the classes it was made to find, which are its model's or
fewer of them: the traditional baseline calls every seed `ungerminated`, and a
version trained while the seed model told two states apart goes on finding
those two. A class a version does not find counts zero in what it reads, and
a reviewer marks it. What a person reviewed or counted by hand while the seed
model told two states apart stands as they made it, holding no `empty` and no
`dead` seeds.

A model can exist without a version; its images can still carry reviews and AI proposals. Version behavior follows the [model lifecycle](domain.md#models-and-versions).

## What an observation declares

An observation declares the date it was made, the model its photographs are
read for, and which of that model's classes the day counts. Which version has
read an image is recorded with that image's detection, and the version that
reads for a model follows the [model lifecycle](domain.md#models-and-versions).

What a day counts is the experiment's question, not the model's. A germination
trial photographs its dishes before anything has germinated and counts every
seed that holds an embryo, `ungerminated`, `germinated` and `dead` alike, and
leaves `empty` out, since a seed without an embryo was never going to
germinate; later days count `germinated` alone, since grown seedlings hide the
seeds that have not germinated and the photograph does not show them all.

The model only says where a day starts from. Among its settings are the
classes a day counts unless it names its own: every class for a new model,
and for `seed-detector` the three states of a seed that holds an embryo. A
day keeps the classes it was given when that setting changes, may count any
of its model's classes whatever the setting, and always counts at least one.

## Where the numbers come from

What an experiment needs of a unit on a day is a number: how many
individuals of each class it held. A photograph is one way to get it, and
the usual one; a person counting the dish at the bench is another. Where the
number came from is kept beside it, and the number enters the statistics.

A cell is one unit on one observation. It holds the photograph taken of the unit that day and the count entered by hand for it, when there are any; one unit has at most one of each per day.

An annotated photograph yields a tally: how many instances of each class its boxes contain. An image can hold three annotation layers, and they rank: a reviewer's
review outranks an AI agent's proposal, which outranks the model’s
detection. Only a review marks the image reviewed; the units table distinguishes it from automated annotations. The units table and resolved sheet use detections from the current model version. The image review page can display the newest version that has detected the image while the current version’s result is pending; that displayed fallback does not become the units table’s detection.

A count entered by hand is a tally too, kept by class, for a day that was
not photographed or a dish that was counted at the bench, such as when its
seedlings were moved. It is entered for an observation one treatment at a
time, a row per unit and a field per class the day counts. When it supplies every counted class, it takes precedence over the photograph. The units table marks it as a count entered by hand. Counts and observation edits follow the [record lifetime rules](domain.md#experimental-design).

A photograph's tally leaves out a class it found none of, and that class
counts zero. A person's count may not: a class the day counts and the count
never gave is unanswered, not zero, so the count must give every class the
day counts, and if the day later comes to count a class the count did not
give, the cell reads from its photograph instead, or has no number.

A count is how many instances of the classes its day counts a unit's tally holds. The tally keeps every class whatever the day counts; changing the classes recounts the same tallies and reads nothing again.

## What the units table shows

A row is a unit, beside the treatment it belongs to and its
[baseline](#what-a-rate-is-taken-over): the number its rates are taken over,
read like a day's count, with the observation under it where the unit names
one. A baseline a rate waits on, the unit having numbers in the statistics
and nothing to rate them by, is the one that asks for attention: it is named
missing in the warning color, with the observation and why it gave no number
under it. One nothing waits on, a unit not read yet or out of the statistics,
is only absent. The baseline opens the choice of its observation, which says
for each what it would give. A column is the day. Under
the date it names the model only when the days do not all read for the same
one, and the classes it counts only when they are fewer than its model
recognizes. A cell shows the unit's count. A count a person stands behind,
by reviewing the photograph or by entering it, is shown plain, one nobody
has reviewed yet provisional, and one entered by hand carries a small mark.
A count read by a version that does not find every class of its model names
the classes that version does not find, since it boxed their individuals as
another class or not at all.
A day out of the statistics is struck through, and an unclear photograph
carries a small mark whether or not it counts, so a count struck through for
one shows why. A count entered by hand that no longer answers what its day
counts asks for attention the same way. Hovering says why, and names the
culture event where one took the day out. A photograph not yet read appears as a photograph; a unit without a photograph or count entered by hand shows no value. A failed image reading is marked.

## What the spreadsheet carries

The experiment page's **Export spreadsheet** command downloads an `.xlsx` file of two sheets: the units' records, and the summary of them
by treatment. The records sheet's block at the top names the experiment,
its plant material, explant type and base medium, the day it was inoculated and
the day the file was taken. Below that the design repeats down every row —
treatment, factor, unit and the unit's baseline as a number, blank where it
has none — so the table sorts, filters and pivots on it and a rate can be
taken in the file, and each
observation heads the column of counts it read, one row per unit. Under its date
a day names its model, and the classes it counts when they are fewer than the
model recognizes.

Quantities stay quantities and days stay days. A count is a number cell whoever stood behind it, and a day is a date cell, not text.
The sheet records what the dish did rather than what the workbench is doing:
a reading still to come, or a day with neither photograph nor count, leaves
its cell empty, and a day out of the statistics carries why in place of its
number: the name of the event that took it out, or else the word for
unclear. Under the summary sheet's notes, the units that take their baseline
from another observation than the first are named with that observation.

## What an agent reads

An agent reads the experiment as a sheet (`domain/experiments/sheet.ts`): the
design, and a page of rows, each a unit's cell on every observation; the
summary by treatment is read on its own. A unit's row is resolved from that
unit's records alone, so a page of rows, one row or every row reads the same
cells. Each row also carries the unit's baseline: the observation its rates
are taken against, the number that day gives and who stood behind it, why
there is none (`gap`), and whether a rate waits on it (`wanted`). Each cell is
resolved here, by the same function the units table and the spreadsheet use
(`unitAnalysis` in `domain/experiments/analysis.ts`, which reads a unit
once): the reading counted in the statistics and who stood behind it, its
rate over the unit's baseline on a day that takes one, why the day is out of
the statistics if it is, and under them the photograph and the
count entered by hand the reading came from. A reading also names the classes
its number could not have told apart: those the detecting version does not
find where the number is that version's, and none where a person or an agent
stands behind it. An agent therefore never ranks annotation layers, applies
the exclusion rules, or averages a treatment itself, and a change to any of
them changes what every reader sees at once. The units table shows these same
rows, a page at a time.

## What the summary says

The summary (`domain/experiments/summary.ts`) is the experiment by treatment:
on each observation, how many of a treatment's units have a number in the
statistics, the mean of those numbers, and their spread as the sample standard
deviation and standard error. The unit is the replicate, so the statistics are
taken over units and never over the individuals they hold: three dishes give
n = 3 whatever they were sown with. A single unit has a mean and no spread,
and a unit out of the statistics that day is not among the n.

Two numbers are summarised, both as the unit's row holds them. The count is
what the unit read that day. The rate is that count over the unit's [baseline](#what-a-rate-is-taken-over),
its own count on the first observation unless it names another: a germination
trial's rate is the seeds germinated over the seeds sown in the same dish, and
the treatment's rate is the mean of its dishes' rates, not the germinated over
the sown of all of them together. A day is read by its rate where any
treatment has one, and by its count otherwise. The summary also names the
units whose baseline a rate waits on (`unrated`), since their numbers are in
the counts and in no rate; the summary tab says so above its chart.

The [experiment page](interface.md#pages-and-interaction-ownership) presents the summary. The spreadsheet carries it as its second sheet, with n, mean, SD and SE under each date; an agent reads it with `get-experiment-summary`. It is always taken over every unit, whatever page of them is on show. Whether the
treatments differ significantly is a question the summary does not answer:
the test and the multiple-comparison method are the researcher's to choose,
so that work is done on the exported numbers.

## What a rate is taken over

The analysis (`domain/experiments/analysis.ts`) asks three things of a unit,
each on its own: what a day's number is and whether it can be used, asked of
the cell; whether the unit is still in the experiment, asked of its culture
events; and what its rates are taken over, asked of the unit once.
`unitAnalysis` puts the three answers together, a unit read once, and the
units table, the spreadsheet, the summary and the agent's sheet read that and
nothing under it, so a rule about one never reaches into another.

A unit's baseline is the number its rates are taken over: how many individuals
the dish holds. It is the unit's count on the first observation, the day
everything sown was counted. What the first observation counts is therefore
what the rate is taken of: a trial that leaves `empty` out of that day reads
its rate over the seeds that hold an embryo, and a count entered by hand for
that day corrects the number where the photograph could not tell them apart.

A unit may name another observation instead, where its first gave no number
that can be used, an unclear photograph or none, and a later day still shows
every individual. Its baseline is then its tally of that day counted over the
classes the first observation counts, whatever that day itself counts, since a
tally keeps every class. A person names it, for one unit or many, because only
a person can say that grown seedlings do not yet hide the seeds under them; no
day stands in for the first on its own. Naming a baseline, or returning to the
first, reads nothing again. Deleting the observation named returns its units
to the first.

A baseline has no number where its day has nothing read over those classes, is
out of the statistics, or reads for another model than the first observation.
A unit without one keeps its counts in the summary and has no rate. A rate
exists on a day in the statistics that reads for the model the first
observation read for; the first observation itself has none, since its count
is what the others are taken of, and a day read for another model has counts
alone.

## What takes a day out of the statistics

A unit's day out of the statistics contributes to no treatment summary that
day, and no day comparison measures a change across it. Two things take a day
out.

A culture event takes it out from the observation that records it:
contaminated, discarded, and missing do. Nonviable does not. Harvested keeps
it included on the recorded observation and excludes it from later ones, when
the unit has left the bench. What came before the event still happened, so
the earlier days stand.

An unclear photograph is one a person could not read clearly, a fogged lid
or a dish out of focus. The mark is the image's, wherever it is shown.
Whether an unclear photograph counts is each experiment's setting, and it does
not unless someone turns the setting on. Where it does not, the photograph
takes out the day whose number is read from it and no other: marking it says
that this photograph cannot be read, not that the dish's record is in doubt,
so the unit's other days stand, and a rate on a later day is still taken over
its baseline. A count entered by hand for the day stands too, whatever the
photograph shows, since the number is no longer the photograph's. A dish whose
whole record is in doubt is a matter for a culture event. A day an event takes
out names the event, unclear or not. Where unclear photographs count, the
number is used as it stands. Either way the photograph is still read and
shown, and datasets train on it.

A day with neither photograph nor count entered by hand takes nothing out: the unit
has no number that day, and its other days count as they are.

Marking, clearing, recording an event, naming a baseline or changing the
setting reads nothing again; it only changes what counts.
