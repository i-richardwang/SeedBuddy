import { z } from "zod";

import { REVIEW_SOURCES, type ReviewSource } from "../annotation/schema";
import { countClasses, sameClasses, type Tally } from "../models/classes";
import { UnknownClassError } from "../models/errors";
import type { ImageReview, ObservationImageCell } from "./contracts";
import type { ExperimentObservation, ManualReading } from "./schema";

/**
 * Who stood behind a unit's number: a person who counted the dish itself
 * and entered the count, or one of the readings of its photograph.
 */
export const READING_SOURCES = [...REVIEW_SOURCES, "manual"] as const;

export type ReadingSource = (typeof READING_SOURCES)[number];

/** What a unit read on a day: the individuals found, and who stood behind the number. */
export const readingSchema = z.strictObject({
  count: z.number().int().min(0),
  source: z.enum(READING_SOURCES),
});
export type Reading = z.infer<typeof readingSchema>;

/**
 * The classes a day counts, in the order its model declares them: every class
 * the model recognizes, unless the day names fewer of them.
 */
export function resolveCountedClasses(
  modelClasses: readonly string[],
  requested: readonly string[] | undefined,
): string[] {
  if (!requested) return [...modelClasses];
  const unknown = requested.filter((name) => !modelClasses.includes(name));
  if (unknown.length > 0) {
    throw new UnknownClassError(
      `The model does not recognize ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
  return modelClasses.filter((name) => requested.includes(name));
}

export function cellKey(unit: string, observation: string): string {
  return `${unit}:${observation}`;
}

/**
 * One unit on one day: the photograph taken of it, and the count a person
 * entered for it. A cell exists once it has either; a number comes from
 * whichever it has, and from the person's when it has both.
 */
export interface UnitCell {
  image: ObservationImageCell | null;
  manual: ManualReading | null;
}

const EMPTY_CELL: UnitCell = { image: null, manual: null };

/** An experiment's cells, by unit and observation. */
export type ObservationCells = ReadonlyMap<string, UnitCell>;

export function observationCells(
  images: readonly ObservationImageCell[],
  manualReadings: readonly ManualReading[],
): ObservationCells {
  const cells = new Map<string, UnitCell>();
  for (const image of images) {
    cells.set(cellKey(image.unit, image.observation), { image, manual: null });
  }
  for (const manual of manualReadings) {
    const key = cellKey(manual.unit, manual.observation);
    cells.set(key, { image: cells.get(key)?.image ?? null, manual });
  }
  return cells;
}

/** A photograph is reviewed once a person has stored its boxes. */
export function imageReview(image: ObservationImageCell): ImageReview {
  return image.annotationTally ? "reviewed" : "unreviewed";
}

/**
 * The tally a photograph reads by, and whose it is. A reviewer's annotation
 * outranks an agent's proposal, which outranks the detection; an image still
 * waiting or failed reads by nothing.
 */
function imageTally(
  image: ObservationImageCell | null | undefined,
): { tally: Tally; source: ReviewSource } | null {
  if (!image) return null;
  if (image.annotationTally) {
    return { tally: image.annotationTally, source: "review" };
  }
  if (image.proposalTally) {
    return { tally: image.proposalTally, source: "proposal" };
  }
  if (image.detectionTally) {
    return { tally: image.detectionTally, source: "detection" };
  }
  return null;
}

/**
 * What a day's photograph reads, counting the classes the day counts, or
 * nothing while there is no photograph or it has no reading.
 */
export function imageReading(
  image: ObservationImageCell | null | undefined,
  observation: Pick<ExperimentObservation, "countedClasses">,
): Reading | null {
  const reading = imageTally(image);
  return reading
    ? {
        count: countClasses(reading.tally, observation.countedClasses),
        source: reading.source,
      }
    : null;
}

/**
 * What a person's count reads over the classes the day counts. A photograph's
 * tally leaves out the classes it found none of, but a person counts only
 * what they are asked, so a class the day counts and the count never gave
 * is not zero: it is unanswered, and the day has no number from it.
 */
function manualReading(
  manual: ManualReading | null,
  observation: Pick<ExperimentObservation, "countedClasses">,
): Reading | null {
  if (!manual) return null;
  const answered = observation.countedClasses.every((name) =>
    Object.hasOwn(manual.tally, name),
  );
  return answered
    ? {
        count: countClasses(manual.tally, observation.countedClasses),
        source: "manual",
      }
    : null;
}

/**
 * What a cell reads, counting the classes its day counts: the count a person
 * entered when there is one, else what its photograph reads, else nothing.
 */
export function cellReading(
  cell: UnitCell | null | undefined,
  observation: Pick<ExperimentObservation, "countedClasses">,
): Reading | null {
  if (!cell) return null;
  return (
    manualReading(cell.manual, observation) ??
    imageReading(cell.image, observation)
  );
}

/** What a unit read on a day, or nothing while its cell has no reading. */
export function unitReading(
  cells: ObservationCells,
  unit: string,
  observation: ExperimentObservation,
): Reading | null {
  return cellReading(cells.get(cellKey(unit, observation.id)), observation);
}

/** A unit's day: the observation, and the unit's cell of it. */
export interface UnitDay extends UnitCell {
  observation: ExperimentObservation;
}

/** A unit's days in the experiment's order. */
export function unitDays(
  cells: ObservationCells,
  unit: string,
  observations: readonly ExperimentObservation[],
): UnitDay[] {
  return observations.map((observation) => ({
    observation,
    ...(cells.get(cellKey(unit, observation.id)) ?? EMPTY_CELL),
  }));
}

/**
 * How much a unit's count rose from one day to another, or nothing unless
 * both days read and count alike: by one model, over the same classes. Counts
 * taken any other way measure different things.
 */
export function countChange(from: UnitDay, to: UnitDay): number | null {
  const alike =
    from.observation.modelId === to.observation.modelId &&
    sameClasses(from.observation.countedClasses, to.observation.countedClasses);
  if (!alike) return null;
  const before = cellReading(from, from.observation);
  const after = cellReading(to, to.observation);
  return before && after ? after.count - before.count : null;
}
