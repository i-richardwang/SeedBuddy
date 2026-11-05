import { z } from "zod";

import { timestampSchema } from "../time";
import {
  type CalendarDay,
  type ExperimentObservation,
  experimentIdSchema,
  observationIdSchema,
  unitCodeSchema,
  unitIdSchema,
  unitSelectionSchema,
} from "./schema";

export const CULTURE_EVENT_TYPES = [
  "contaminated",
  "nonviable",
  "discarded",
  "harvested",
  "missing",
] as const;

export type CultureEventType = (typeof CULTURE_EVENT_TYPES)[number];

const cultureEventTypeSchema = z.enum(CULTURE_EVENT_TYPES);

const cultureEventIdSchema = z.uuid();

export const cultureEventSchema = z.strictObject({
  id: cultureEventIdSchema,
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
  recordedAt: timestampSchema,
});

export type CultureEvent = z.infer<typeof cultureEventSchema>;

export const cultureEventsRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  units: unitSelectionSchema,
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventsRequest = z.infer<typeof cultureEventsRequestSchema>;

/**
 * Why a unit cannot take an event on a day: it holds the same event that
 * day, it already left the bench and the event would take it off again, it
 * left the bench before that day, or it has records after a day it would
 * leave the bench on.
 */
export const CULTURE_EVENT_REFUSALS = [
  "recorded",
  "already_left",
  "left_before",
  "later_records",
] as const;

export type CultureEventRefusal = (typeof CULTURE_EVENT_REFUSALS)[number];

/**
 * What recording an event did: the events recorded, and the units of a
 * selection by treatment it passed over, each with why. Units named one by
 * one are never passed over; the command is refused instead.
 */
export const cultureEventsResultSchema = z.strictObject({
  recorded: z.array(
    z.strictObject({ unit: unitIdSchema, event: cultureEventSchema }),
  ),
  passedOver: z.array(
    z.strictObject({
      unit: unitIdSchema,
      code: unitCodeSchema,
      reason: z.enum(CULTURE_EVENT_REFUSALS),
    }),
  ),
});

export type CultureEventsResult = z.infer<typeof cultureEventsResultSchema>;

export const cultureEventRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  event: cultureEventIdSchema,
});

export type CultureEventRef = z.infer<typeof cultureEventRefSchema>;

export type ObservationOrdinals = ReadonlyMap<string, number>;

/** Where each observation falls in the experiment's series. */
export function observationOrdinals(
  observations: readonly { id: string; ordinal: number }[],
): ObservationOrdinals {
  return new Map(observations.map((item) => [item.id, item.ordinal]));
}

export function observationOrdinal(
  ordinals: ObservationOrdinals,
  observation: string,
): number {
  const ordinal = ordinals.get(observation);
  if (ordinal === undefined) {
    throw new Error(`Unknown observation: ${observation}`);
  }
  return ordinal;
}

/**
 * What an event means for the unit: whether it leaves the bench, and whether
 * its readings leave the analysis.
 */
interface CultureEventKind {
  terminal: boolean;
  excludesFromAnalysis: boolean;
}

const CULTURE_EVENT_KINDS: Record<CultureEventType, CultureEventKind> = {
  contaminated: {
    terminal: false,
    excludesFromAnalysis: true,
  },
  nonviable: {
    terminal: false,
    excludesFromAnalysis: false,
  },
  discarded: {
    terminal: true,
    excludesFromAnalysis: true,
  },
  harvested: {
    terminal: true,
    excludesFromAnalysis: false,
  },
  missing: {
    terminal: true,
    excludesFromAnalysis: true,
  },
};

export function cultureEventIsTerminal(type: CultureEventType): boolean {
  return CULTURE_EVENT_KINDS[type].terminal;
}

/** The events that take a unit off the bench. */
export const TERMINAL_CULTURE_EVENT_TYPES: readonly CultureEventType[] =
  CULTURE_EVENT_TYPES.filter(cultureEventIsTerminal);

export function cultureEventExcludesFromAnalysis(
  type: CultureEventType,
): boolean {
  return CULTURE_EVENT_KINDS[type].excludesFromAnalysis;
}

function eventOrdinal(
  event: CultureEvent,
  ordinals: ObservationOrdinals,
): number {
  return observationOrdinal(ordinals, event.observation);
}

/**
 * The day the unit left the bench: the day of the observation that recorded
 * its terminal event, of which a unit has one at most, or null while it is
 * on the bench.
 */
export function unitLeftOn(
  events: readonly CultureEvent[],
  observations: readonly ExperimentObservation[],
): CalendarDay | null {
  const exit = events.find((event) => cultureEventIsTerminal(event.type));
  if (!exit) return null;
  const observation = observations.find((item) => item.id === exit.observation);
  if (!observation) throw new Error(`Unknown observation: ${exit.observation}`);
  return observation.observedOn;
}

/**
 * Whether a unit that left the bench on `leftOn` can still be photographed
 * or counted on `day`: a terminal event takes effect after its day.
 */
export function onBenchOn(
  leftOn: CalendarDay | null,
  day: CalendarDay,
): boolean {
  return leftOn === null || day <= leftOn;
}

/** Whether a unit is on the bench on the observation's day, judged by its events. */
export function unitIsOnBench(
  events: readonly CultureEvent[],
  observations: readonly ExperimentObservation[],
  observation: ExperimentObservation,
): boolean {
  return onBenchOn(unitLeftOn(events, observations), observation.observedOn);
}

/**
 * What an event is judged against on a unit: its events, and the
 * observations it has a photograph or an entered count on. Only those after
 * the event's observation weigh, so a caller may read no others.
 */
export interface UnitRecords {
  events: readonly CultureEvent[];
  recorded: readonly string[];
}

/** Why the unit cannot take an event of `type` on the observation; null where it can. */
export function cultureEventRefusal(
  unit: UnitRecords,
  observations: readonly ExperimentObservation[],
  observation: ExperimentObservation,
  type: CultureEventType,
): CultureEventRefusal | null {
  const { events } = unit;
  const leaves = cultureEventIsTerminal(type);
  if (
    events.some(
      (event) => event.observation === observation.id && event.type === type,
    )
  )
    return "recorded";
  if (leaves && events.some((event) => cultureEventIsTerminal(event.type)))
    return "already_left";
  if (!unitIsOnBench(events, observations, observation)) return "left_before";
  if (leaves && hasRecordsAfter(unit, observations, observation))
    return "later_records";
  return null;
}

/**
 * Whether a unit leaving the bench on the observation would leave records
 * behind it: an event, a photograph or an entered count of a later
 * observation.
 */
export function hasRecordsAfter(
  unit: UnitRecords,
  observations: readonly ExperimentObservation[],
  observation: ExperimentObservation,
): boolean {
  const later = new Set(
    observations
      .filter((day) => day.ordinal > observation.ordinal)
      .map((day) => day.id),
  );
  return [
    ...unit.recorded,
    ...unit.events.map((event) => event.observation),
  ].some((recorded) => later.has(recorded));
}

/**
 * The culture event that takes the unit out of the analysis on this
 * observation, when one does. An exclusion starts in its recorded
 * observation; leaving the bench also takes the unit out of every later
 * denominator. The earliest such event is the one that decided it, and the
 * one worth naming.
 */
export function excludingEvent(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): CultureEvent | null {
  return events.reduce<CultureEvent | null>((decided, event) => {
    const ordinal = eventOrdinal(event, ordinals);
    const excludes =
      (cultureEventExcludesFromAnalysis(event.type) &&
        ordinal <= observation.ordinal) ||
      (cultureEventIsTerminal(event.type) && ordinal < observation.ordinal);
    if (!excludes) return decided;
    if (!decided) return event;
    return ordinal < eventOrdinal(decided, ordinals) ? event : decided;
  }, null);
}

/** The latest biological event, regardless of when it was entered. */
export function latestCultureEvent(
  events: readonly CultureEvent[],
  ordinals: ObservationOrdinals,
): CultureEvent | null {
  return events.reduce<CultureEvent | null>((latest, event) => {
    if (!latest) return event;
    const byObservation =
      eventOrdinal(event, ordinals) - eventOrdinal(latest, ordinals);
    if (byObservation !== 0) return byObservation > 0 ? event : latest;
    return event.recordedAt > latest.recordedAt ? event : latest;
  }, null);
}
