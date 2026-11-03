import { classCount, type Tally } from "./classes";
import type {
  ComparedImage,
  ComparedReading,
  CountAccuracy,
  VersionComparison,
  VersionComparisonDetail,
} from "./read-model";

/** Whether either version has held-out images still to read. */
export function isReading(comparison: VersionComparison): boolean {
  const { heldOut, candidate, current } = comparison;
  const done = ({ read, failed }: VersionComparison["candidate"]) =>
    read + failed >= heldOut;
  return !done(candidate) || (current !== null && !done(current));
}

export function isCounted(reading: ComparedReading): reading is Tally {
  return reading !== null && reading !== "failed";
}

function classError(reviewed: Tally, reading: Tally, name: string): number {
  return Math.abs(classCount(reading, name) - classCount(reviewed, name));
}

/** How far a reading is from the reviewer's count, summed over the classes. */
export function countError(
  classes: readonly string[],
  reviewed: Tally,
  reading: Tally,
): number {
  return classes.reduce(
    (sum, name) => sum + classError(reviewed, reading, name),
    0,
  );
}

function progress(readings: ComparedReading[]): VersionComparison["candidate"] {
  return {
    read: readings.filter(isCounted).length,
    failed: readings.filter((reading) => reading === "failed").length,
  };
}

function accuracy(
  classes: readonly string[],
  pairs: { reviewed: Tally; reading: Tally }[],
): CountAccuracy {
  return {
    meanError: Object.fromEntries(
      classes.map((name) => [
        name,
        pairs.reduce(
          (sum, { reviewed, reading }) =>
            sum + classError(reviewed, reading, name),
          0,
        ) / pairs.length,
      ]),
    ),
  };
}

export function compareVersions(
  classes: readonly string[],
  currentVersionId: string | null,
  images: ComparedImage[],
): VersionComparisonDetail {
  const scored = images.flatMap(({ reviewed, candidate, current }) =>
    isCounted(candidate) && (currentVersionId === null || isCounted(current))
      ? [{ reviewed, candidate, current: isCounted(current) ? current : null }]
      : [],
  );
  return {
    currentVersionId,
    heldOut: images.length,
    candidate: progress(images.map((image) => image.candidate)),
    current:
      currentVersionId === null
        ? null
        : progress(images.map((image) => image.current)),
    scored: scored.length,
    accuracy:
      scored.length === 0
        ? null
        : {
            candidate: accuracy(
              classes,
              scored.map(({ reviewed, candidate }) => ({
                reviewed,
                reading: candidate,
              })),
            ),
            current:
              currentVersionId === null
                ? null
                : accuracy(
                    classes,
                    scored.flatMap(({ reviewed, current }) =>
                      current ? [{ reviewed, reading: current }] : [],
                    ),
                  ),
          },
    images,
  };
}
