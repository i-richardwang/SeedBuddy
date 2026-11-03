import { z } from "zod";

import { timestampSchema } from "../time";
import {
  experimentIdSchema,
  observationIdSchema,
  unitIdSchema,
  unitRefSchema,
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

const cultureEventRequestSchema = unitRefSchema.extend({
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventRequest = z.infer<typeof cultureEventRequestSchema>;

export const cultureEventsRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  units: z
    .array(unitIdSchema)
    .min(1)
    .max(200)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Units must be distinct",
    ),
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventsRequest = z.infer<typeof cultureEventsRequestSchema>;

export const cultureEventRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  event: cultureEventIdSchema,
});

export type CultureEventRef = z.infer<typeof cultureEventRefSchema>;

import type { CalendarDay, ExperimentObservation } from "./schema";

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

/** A terminal event takes effect after the observation that records it. */
export function unitIsAvailableAt(
  events: readonly CultureEvent[],
  observation: ExperimentObservation,
  ordinals: ObservationOrdinals,
): boolean {
  return !events.some(
    (event) =>
      cultureEventIsTerminal(event.type) &&
      eventOrdinal(event, ordinals) < observation.ordinal,
  );
}

/**
 * Whether the unit can be photographed on a day not yet recorded: no
 * terminal event was recorded on an earlier observation.
 */
export function unitIsAvailableOn(
  events: readonly CultureEvent[],
  observedOn: CalendarDay,
  observations: readonly ExperimentObservation[],
): boolean {
  const earlier = new Set(
    observations
      .filter((observation) => observation.observedOn < observedOn)
      .map((observation) => observation.id),
  );
  return !events.some(
    (event) =>
      cultureEventIsTerminal(event.type) && earlier.has(event.observation),
  );
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
