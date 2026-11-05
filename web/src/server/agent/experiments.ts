import { z } from "zod";

import {
  cultureEventRefSchema,
  cultureEventsRequestSchema,
  cultureEventsResultSchema,
} from "../../domain/experiments/culture-events";
import {
  ExperimentNotFoundError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import {
  experimentOverviewSchema,
  experimentSheetSchema,
  experimentSummarySchema,
  unitPageRequestSchema,
  unitRowOverviewSchema,
  unitSchema,
} from "../../domain/experiments/read-model";
import {
  experimentObservationSchema,
  experimentRefSchema,
  experimentRequestSchema,
  experimentSchema,
  experimentUpdateSchema,
  manualReadingSchema,
  manualReadingsRequestSchema,
  observationImageAssignmentResultSchema,
  observationImageAssignmentSchema,
  observationImageRefSchema,
  observationRecordSchema,
  observationRefSchema,
  observationUpdateSchema,
  replicateRequestSchema,
  treatmentRefSchema,
  treatmentRequestSchema,
  treatmentSchema,
  treatmentUpdateSchema,
  unitRefSchema,
  unitsTreatmentUpdateSchema,
  unitUpdateSchema,
} from "../../domain/experiments/schema";
import { imageRefSchema } from "../../domain/images/schema";
import {
  unclearClearedSchema,
  unclearMarkedSchema,
} from "../../domain/images/unclear";
import {
  addReplicates,
  addTreatment,
  assignObservationImages,
  createExperiment,
  deleteCultureEvent,
  deleteExperiment,
  deleteObservation,
  deleteTreatment,
  deleteUnit,
  moveUnits,
  recordCultureEvents,
  recordManualReadings,
  recordObservation,
  retryObservationImageAnalysis,
  unassignObservationImage,
  updateExperiment,
  updateObservation,
  updateTreatment,
  updateUnit,
} from "../experiments/public";
import { clearImageUnclear, markImageUnclear } from "../images/public";
import {
  experimentSheetDetail,
  experimentSummaryDetail,
  listExperimentOverviews,
  unitRowOverview,
} from "../queries/public";
import { command, query } from "./definition";

/**
 * An experiment is a design and the records taken against it. The design is
 * treatments, units and observations; a record is a photograph, a count
 * entered by hand, or a culture event, and a design entry that holds records
 * stays. What an agent reads back is the sheet: every cell resolved to the
 * reading the analysis uses, over the evidence behind it.
 */
export const experimentOperations = [
  query({
    name: "list-experiments",
    description:
      "List every experiment with the size of its design and how far its observations have come",
    input: z.strictObject({}),
    output: z.array(experimentOverviewSchema),
    handler: () => listExperimentOverviews(),
  }),
  query({
    name: "get-experiment",
    description:
      "Read a page of an experiment's sheet: its design, and for each unit on the page, of one treatment or of all, a cell on every observation with the reading the analysis uses and who stood behind it, why the day is out of the analysis if it is, and the photograph and count entered by hand the reading came from. Units come in the experiment's order; `units.total` counts the units pages are drawn from and `units.pages` the pages they fill, and a page past the last holds no rows. A treatment the experiment does not have is refused",
    input: experimentRefSchema.extend(unitPageRequestSchema.shape),
    output: experimentSheetSchema,
    handler: async ({ experiment, ...page }) => {
      const sheet = await experimentSheetDetail(experiment, page);
      if (!sheet) {
        throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
      }
      return sheet;
    },
  }),
  query({
    name: "get-experiment-summary",
    description:
      "Read an experiment summarised by treatment on every observation: how many units are in the analysis, and the mean, SD and SE of their counts and of their rates against each unit's count on the first observation",
    input: experimentRefSchema,
    output: experimentSummarySchema,
    handler: async ({ experiment }) => {
      const summary = await experimentSummaryDetail(experiment);
      if (!summary) {
        throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
      }
      return summary;
    },
  }),
  query({
    name: "get-unit",
    description:
      "Read one unit's row of the sheet: its treatment, its culture events, and its cell on every observation",
    input: unitRefSchema,
    output: unitRowOverviewSchema,
    handler: async (ref) => {
      const row = await unitRowOverview(ref);
      if (!row) {
        throw new UnitNotFoundError(
          `Unknown unit: ${ref.unit} in experiment ${ref.experiment}`,
        );
      }
      return row;
    },
  }),
  command({
    transaction: "operation",
    name: "create-experiment",
    description:
      "Create an experiment with its design. countsUnclear says whether a unit with a photograph marked unclear stays in the analysis; by default it does not, and the unit is out on every day",
    destructive: false,
    input: experimentRequestSchema,
    output: experimentSchema,
    handler: (input, db) => createExperiment(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-experiment",
    description:
      "Correct an experiment's name, protocol fields, notes, inoculation date, or whether its unclear photographs count; changing countsUnclear reads nothing again",
    destructive: true,
    input: experimentUpdateSchema,
    output: experimentSchema,
    handler: (input, db) => updateExperiment(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-experiment",
    description: "Delete an experiment that holds no records",
    destructive: true,
    input: experimentRefSchema,
    output: z.null(),
    handler: (input, db) => deleteExperiment(input, db),
  }),
  command({
    transaction: "operation",
    name: "create-treatment",
    description: "Add a treatment and lay out its replicates",
    destructive: false,
    input: treatmentRequestSchema,
    output: treatmentSchema,
    handler: (input, db) => addTreatment(input, db),
  }),
  command({
    transaction: "operation",
    name: "add-replicates",
    description: "Lay out more replicates of a treatment",
    destructive: false,
    input: replicateRequestSchema,
    output: z.array(unitSchema),
    handler: (input, db) => addReplicates(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-treatment",
    description: "Correct a treatment's name, factor, or note",
    destructive: true,
    input: treatmentUpdateSchema,
    output: treatmentSchema,
    handler: (input, db) => updateTreatment(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-treatment",
    description:
      "Delete a treatment and its units; the experiment's last treatment stays, and so does one whose units hold records",
    destructive: true,
    input: treatmentRefSchema,
    output: z.null(),
    handler: (input, db) => deleteTreatment(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-unit",
    description:
      "Correct a unit's code or treatment, preserving its identity and records",
    destructive: true,
    input: unitUpdateSchema,
    output: unitSchema,
    handler: (input, db) => updateUnit(input, db),
  }),
  command({
    transaction: "operation",
    name: "move-units",
    description:
      "Move units named one by one to another treatment together; each keeps its code and records. Refused when a treatment they leave would keep no unit",
    destructive: true,
    input: unitsTreatmentUpdateSchema,
    output: z.array(unitSchema),
    handler: (input, db) => moveUnits(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-unit",
    description:
      "Delete a unit that holds no records and is not its treatment's last replicate",
    destructive: true,
    input: unitRefSchema,
    output: z.null(),
    handler: (input, db) => deleteUnit(input, db),
  }),
  command({
    transaction: "operation",
    name: "create-observation",
    description:
      "Add an observation to an experiment: the date, the recognition task its photographs are read for, which of that model's classes its count sums (every class when omitted), and the photographs taken on it matched to their units, or none yet",
    destructive: false,
    input: observationRecordSchema,
    output: experimentObservationSchema,
    handler: (input, db) => recordObservation(input, db),
  }),
  command({
    transaction: "operation",
    name: "update-observation",
    description:
      "Correct an observation's date, note, recognition task, or the classes its count sums; photographs already taken are read again for a new task, and a change of classes recounts every reading without reading again",
    destructive: true,
    input: observationUpdateSchema,
    output: experimentObservationSchema,
    handler: (input, db) => updateObservation(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-observation",
    description: "Delete an observation that holds no records",
    destructive: true,
    input: observationRefSchema,
    output: z.null(),
    handler: (input, db) => deleteObservation(input, db),
  }),
  command({
    transaction: "operation",
    name: "assign-images-to-observation",
    description:
      "Match stored photographs to units in one observation; a unit already photographed that day is given the new one. Upload bytes first to obtain each digest. An entry with unclear true marks its photograph unclear in the same step; a mark the photograph has is never cleared here",
    destructive: false,
    input: observationImageAssignmentSchema,
    output: observationImageAssignmentResultSchema,
    handler: (input, db) => assignObservationImages(input, db),
  }),
  command({
    transaction: "operation",
    name: "unassign-observation-image",
    description:
      "Detach a photograph from its observation; the stored image itself remains",
    destructive: true,
    input: observationImageRefSchema,
    output: z.null(),
    handler: (input, db) => unassignObservationImage(input, db),
  }),
  command({
    transaction: "operation",
    name: "retry-observation-image-analysis",
    description: "Queue a photograph whose analysis failed to be read again",
    destructive: true,
    input: observationImageRefSchema,
    output: z.null(),
    handler: (input, db) => retryObservationImageAnalysis(input, db),
  }),
  command({
    transaction: "operation",
    name: "mark-image-unclear",
    description:
      "Mark a stored photograph unclear by digest, such as a fogged lid or a dish out of focus, wherever it is observed. In an experiment that does not count unclear photographs, its unit leaves the analysis on every day: the sheet and comparisons leave it out, while it is still read and shown. Datasets train on it as on any other. marked is false when it was already marked, so repeating a call is safe",
    destructive: true,
    input: imageRefSchema,
    output: unclearMarkedSchema,
    handler: (input, db) => markImageUnclear(input, db),
  }),
  command({
    transaction: "operation",
    name: "clear-image-unclear",
    description:
      "Clear a photograph's unclear mark by digest, so it reads as clear again; nothing is read again. cleared is false when it had no mark, so repeating a call is safe",
    destructive: true,
    input: imageRefSchema,
    output: unclearClearedSchema,
    handler: (input, db) => clearImageUnclear(input, db),
  }),
  command({
    transaction: "operation",
    name: "enter-manual-readings",
    description:
      "Enter the counts people took by hand on one observation, a tally per unit naming every class the day counts; a unit's entered count outranks every reading of its photograph, and a tally of null withdraws it. A unit that left the bench before the observation cannot be counted. Answers the observation's entered counts as they stand afterwards",
    destructive: true,
    input: manualReadingsRequestSchema,
    output: z.array(manualReadingSchema),
    handler: (input, db) => recordManualReadings(input, db),
  }),
  command({
    transaction: "operation",
    name: "record-culture-events",
    description:
      "Record one culture event on units at an observation: contaminated, discarded, and missing take a unit out of the analysis from that observation on; discarded, harvested, and missing take it off the bench afterwards. `units` names units one by one, each of which must take the event, or selects `{treatment, expected}`: every unit of a treatment, or of the experiment for a null treatment, refused unless it holds `expected` units; of those, units that cannot take the event that day are passed over and answered with why",
    destructive: false,
    input: cultureEventsRequestSchema,
    output: cultureEventsResultSchema,
    handler: (input, db) => recordCultureEvents(input, db),
  }),
  command({
    transaction: "operation",
    name: "delete-culture-event",
    description: "Erase a culture event that was recorded by mistake",
    destructive: true,
    input: cultureEventRefSchema,
    output: z.null(),
    handler: (input, db) => deleteCultureEvent(input, db),
  }),
];
