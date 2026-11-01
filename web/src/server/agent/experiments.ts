import { z } from "zod";

import { command, query } from "./definition";
import {
  experimentSummarySchema,
  unitSchema,
} from "../../domain/experiments/contracts";
import {
  ExperimentNotFoundError,
  UnitNotFoundError,
} from "../../domain/experiments/errors";
import {
  cultureEventRefSchema,
  cultureEventSchema,
  cultureEventsRequestSchema,
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
  unitUpdateSchema,
  unitsTreatmentUpdateSchema,
} from "../../domain/experiments/schema";
import {
  experimentSheetSchema,
  unitRowSchema,
} from "../../domain/experiments/sheet";
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
  listExperiments,
  moveUnits,
  readExperimentSheet,
  readUnitRow,
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
    output: z.array(experimentSummarySchema),
    handler: () => listExperiments(),
  }),
  query({
    name: "get-experiment",
    description:
      "Read an experiment's sheet: its design, and a cell for every unit on every observation with the reading the analysis uses and who stood behind it, why the day is out of the analysis if it is, and the photograph and count entered by hand the reading came from",
    input: experimentRefSchema,
    output: experimentSheetSchema,
    handler: async ({ experiment }) => {
      const sheet = await readExperimentSheet(experiment);
      if (!sheet) {
        throw new ExperimentNotFoundError(`Unknown experiment: ${experiment}`);
      }
      return sheet;
    },
  }),
  query({
    name: "get-unit",
    description:
      "Read one unit's row of the sheet: its treatment, its culture events, and its cell on every observation",
    input: unitRefSchema,
    output: unitRowSchema,
    handler: async (ref) => {
      const row = await readUnitRow(ref);
      if (!row) {
        throw new UnitNotFoundError(
          `Unknown unit: ${ref.unit} in experiment ${ref.experiment}`,
        );
      }
      return row;
    },
  }),
  command({
    name: "create-experiment",
    description:
      "Create an experiment with its design. countsUnclear says whether a unit with a photograph marked unclear stays in the analysis; by default it does not, and the unit is out on every day",
    destructive: false,
    input: experimentRequestSchema,
    output: experimentSchema,
    handler: (input, executor) => createExperiment(input, executor),
  }),
  command({
    name: "update-experiment",
    description:
      "Correct an experiment's name, protocol fields, notes, inoculation date, or whether its unclear photographs count; changing countsUnclear reads nothing again",
    destructive: true,
    input: experimentUpdateSchema,
    output: experimentSchema,
    handler: (input, executor) => updateExperiment(input, executor),
  }),
  command({
    name: "delete-experiment",
    description: "Delete an experiment that holds no records",
    destructive: true,
    input: experimentRefSchema,
    output: z.null(),
    handler: (input, executor) => deleteExperiment(input, executor),
  }),
  command({
    name: "create-treatment",
    description: "Add a treatment and lay out its replicates",
    destructive: false,
    input: treatmentRequestSchema,
    output: treatmentSchema,
    handler: (input, executor) => addTreatment(input, executor),
  }),
  command({
    name: "add-replicates",
    description: "Lay out more replicates of a treatment",
    destructive: false,
    input: replicateRequestSchema,
    output: z.array(unitSchema),
    handler: (input, executor) => addReplicates(input, executor),
  }),
  command({
    name: "update-treatment",
    description: "Correct a treatment's name, factor, or note",
    destructive: true,
    input: treatmentUpdateSchema,
    output: treatmentSchema,
    handler: (input, executor) => updateTreatment(input, executor),
  }),
  command({
    name: "delete-treatment",
    description:
      "Delete a treatment and its units; the experiment's last treatment stays, and so does one whose units hold records",
    destructive: true,
    input: treatmentRefSchema,
    output: z.null(),
    handler: (input, executor) => deleteTreatment(input, executor),
  }),
  command({
    name: "update-unit",
    description:
      "Correct a unit's code or treatment, preserving its identity and records",
    destructive: true,
    input: unitUpdateSchema,
    output: unitSchema,
    handler: (input, executor) => updateUnit(input, executor),
  }),
  command({
    name: "move-units",
    description:
      "Move units to another treatment together; each keeps its code and records, and a treatment's last replicate stays",
    destructive: true,
    input: unitsTreatmentUpdateSchema,
    output: z.array(unitSchema),
    handler: (input, executor) => moveUnits(input, executor),
  }),
  command({
    name: "delete-unit",
    description:
      "Delete a unit that holds no records and is not its treatment's last replicate",
    destructive: true,
    input: unitRefSchema,
    output: z.null(),
    handler: (input, executor) => deleteUnit(input, executor),
  }),
  command({
    name: "create-observation",
    description:
      "Add an observation to an experiment: the date, the recognition task its photographs are read for, which of that model's classes its count sums (every class when omitted), and the photographs taken on it matched to their units, or none yet",
    destructive: false,
    input: observationRecordSchema,
    output: experimentObservationSchema,
    handler: (input, executor) => recordObservation(input, executor),
  }),
  command({
    name: "update-observation",
    description:
      "Correct an observation's date, note, recognition task, or the classes its count sums; photographs already taken are read again for a new task, and a change of classes recounts every reading without reading again",
    destructive: true,
    input: observationUpdateSchema,
    output: experimentObservationSchema,
    handler: (input, executor) => updateObservation(input, executor),
  }),
  command({
    name: "delete-observation",
    description: "Delete an observation that holds no records",
    destructive: true,
    input: observationRefSchema,
    output: z.null(),
    handler: (input, executor) => deleteObservation(input, executor),
  }),
  command({
    name: "assign-images-to-observation",
    description:
      "Match stored photographs to units in one observation; a unit already photographed that day is given the new one. Upload bytes first to obtain each digest. An entry with unclear true marks its photograph unclear in the same step; a mark the photograph has is never cleared here",
    destructive: false,
    input: observationImageAssignmentSchema,
    output: observationImageAssignmentResultSchema,
    handler: (input, executor) => assignObservationImages(input, executor),
  }),
  command({
    name: "unassign-observation-image",
    description:
      "Detach a photograph from its observation; the stored image itself remains",
    destructive: true,
    input: observationImageRefSchema,
    output: z.null(),
    handler: (input, executor) => unassignObservationImage(input, executor),
  }),
  command({
    name: "retry-observation-image-analysis",
    description: "Queue a photograph whose analysis failed to be read again",
    destructive: true,
    input: observationImageRefSchema,
    output: z.null(),
    handler: (input, executor) =>
      retryObservationImageAnalysis(input, executor),
  }),
  command({
    name: "mark-image-unclear",
    description:
      "Mark a stored photograph unclear by digest, such as a fogged lid or a dish out of focus, wherever it is observed. In an experiment that does not count unclear photographs, its unit leaves the analysis on every day: the sheet and comparisons leave it out, while it is still read and shown. Datasets train on it as on any other. marked is false when it was already marked, so repeating a call is safe",
    destructive: true,
    input: imageRefSchema,
    output: unclearMarkedSchema,
    handler: (input, executor) => markImageUnclear(input, executor),
  }),
  command({
    name: "clear-image-unclear",
    description:
      "Clear a photograph's unclear mark by digest, so it reads as clear again; nothing is read again. cleared is false when it had no mark, so repeating a call is safe",
    destructive: true,
    input: imageRefSchema,
    output: unclearClearedSchema,
    handler: (input, executor) => clearImageUnclear(input, executor),
  }),
  command({
    name: "enter-manual-readings",
    description:
      "Enter the counts people took by hand on one observation, a tally per unit naming every class the day counts; a unit's entered count outranks every reading of its photograph, and a tally of null withdraws it. A unit that left the bench before the observation cannot be counted. Answers the observation's entered counts as they stand afterwards",
    destructive: true,
    input: manualReadingsRequestSchema,
    output: z.array(manualReadingSchema),
    handler: (input, executor) => recordManualReadings(input, executor),
  }),
  command({
    name: "record-culture-events",
    description:
      "Record one culture event on units at an observation: contaminated, discarded, and missing take a unit out of the analysis from that observation on; discarded, harvested, and missing take it off the bench afterwards",
    destructive: false,
    input: cultureEventsRequestSchema,
    output: z.array(cultureEventSchema),
    handler: (input, executor) => recordCultureEvents(input, executor),
  }),
  command({
    name: "delete-culture-event",
    description: "Erase a culture event that was recorded by mistake",
    destructive: true,
    input: cultureEventRefSchema,
    output: z.null(),
    handler: (input, executor) => deleteCultureEvent(input, executor),
  }),
];
