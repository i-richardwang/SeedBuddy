import { useCallback, useState } from "react";

import { onBenchOn } from "../../domain/experiments/culture-events";
import { pairInOrder, suggestUnit } from "../../domain/experiments/naming";
import {
  MAX_PLACED_PHOTOS_ASKED,
  type PhotoConflict,
  type PlacedPhoto,
  photoConflicts,
} from "../../domain/experiments/photos";
import type {
  PhotoSlot,
  PhotoSlots,
} from "../../domain/experiments/read-model";
import type { CalendarDay, UnitPhoto } from "../../domain/experiments/schema";
import { getPlacedPhotos } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { Select } from "../../ui/kit/Select";
import { Tag } from "../../ui/kit/Tag";
import { ImageDropZone } from "../upload/ImageDropZone";
import type { ListedImage } from "../upload/useUploads";
import { type Uploads, useUploads } from "../upload/useUploads";

/** A unit a photograph is matched to, by its code. */
type PhotoUnit = Pick<PhotoSlot, "id" | "code">;

/** Photographs being uploaded for one observation day and matched to its units. */
interface ObservationPhotos {
  uploads: Uploads;
  /** The units on the bench that day, in the experiment's order. */
  units: readonly PhotoUnit[];
  /** Units that already have a photograph that day. */
  assigned: ReadonlySet<string>;
  conflicts: ReadonlyMap<number, PhotoConflict>;
  chosen: ReadonlyMap<number, string>;
  choose: (photo: number, unit: string | null) => void;
  fillInOrder: () => void;
  /** Every stored photograph that has a unit. */
  ready: UnitPhoto[];
  /** Stored photographs still without a unit. */
  unmatched: number;
  /** Units still without a photograph. */
  vacant: number;
  /** Whether the server could not say which photographs the experiment holds. */
  checkFailed: boolean;
  /** Asks the server again about the photographs it could not answer for. */
  recheck: () => void;
  /** Still uploading or checking, a photograph failed to upload, is already used, or has no unit. */
  pending: boolean;
}

/**
 * Uploads the photographs of one observation day and matches each to its
 * unit: the reader's choice where there is one, otherwise the unit its file
 * name suggests, or the shooting order on request. A photograph the
 * experiment already holds cannot be placed again.
 */
export function useObservationPhotos({
  experiment,
  slots,
  day,
}: {
  experiment: string;
  slots: PhotoSlots;
  /** The day photographed, which decides the units still on the bench. */
  day: CalendarDay;
}): ObservationPhotos {
  const units = slots.units.filter((unit) => onBenchOn(unit.leftOn, day));
  const assigned = new Set(slots.taken);
  const placed = usePlacedPhotos(experiment);
  const uploads = useUploads(placed.check);
  const [choices, setChoices] = useState<Record<number, string | null>>({});
  const vacantUnits = units.filter((unit) => !assigned.has(unit.id));
  const stored = storedPhotos(uploads.images);
  const answered = placed.of(stored.map((photo) => photo.digest));
  const conflicts = photoConflicts(stored, answered.photos);
  const free = stored.filter((photo) => !conflicts.has(photo.id));
  const chosen = matchPhotos(free, choices, vacantUnits);
  const ready = free.flatMap((photo) => {
    const unit = chosen.get(photo.id);
    return unit
      ? [{ unit, digest: photo.digest, filename: photo.filename }]
      : [];
  });
  const unmatched = free.length - ready.length;

  return {
    uploads,
    units,
    assigned,
    conflicts,
    chosen,
    choose: (photo, unit) =>
      setChoices((current) => ({ ...current, [photo]: unit })),
    /** Camera names say nothing about dishes; shooting order does. */
    fillInOrder: () => {
      const claimed = new Set(chosen.values());
      const waiting = free.filter((photo) => !chosen.has(photo.id));
      const vacant = vacantUnits
        .filter((unit) => !claimed.has(unit.id))
        .map((unit) => unit.id);
      setChoices({
        ...choices,
        ...Object.fromEntries(pairInOrder(waiting, vacant)),
      });
    },
    ready,
    unmatched,
    vacant: vacantUnits.length - ready.length,
    checkFailed: answered.failed,
    recheck: answered.retry,
    pending:
      uploads.storing ||
      uploads.failed ||
      answered.checking ||
      answered.failed ||
      conflicts.size > 0 ||
      unmatched > 0,
  };
}

/** What the server answered for a photograph: where it is placed, nothing, or no answer yet or at all. */
type PlacedAnswer = PlacedPhoto | null | "checking" | "failed";

/**
 * Which photographs the experiment already holds, asked of the server as
 * each is stored (`check`). `of` reads the answers for the photographs still
 * on hand: a photograph is checking until its answer comes, and one the
 * server could not answer for fails the check until it is asked again, with
 * every other that failed, a batch at a time. Every asking of a photograph
 * gets the same answer, so an answer, once come, stands: asking again does
 * not set it back to checking, and a failure replaces only a check.
 */
function usePlacedPhotos(experiment: string) {
  const [answers, setAnswers] = useState<ReadonlyMap<string, PlacedAnswer>>(
    () => new Map(),
  );
  const ask = useCallback(
    (digests: readonly string[]) => {
      const settle = (
        batch: readonly string[],
        answer: (digest: string, previous?: PlacedAnswer) => PlacedAnswer,
      ) =>
        setAnswers((previous) => {
          const next = new Map(previous);
          for (const digest of batch) {
            next.set(digest, answer(digest, previous.get(digest)));
          }
          return next;
        });
      settle(digests, (_, previous) =>
        previous === undefined || previous === "failed" ? "checking" : previous,
      );
      for (
        let start = 0;
        start < digests.length;
        start += MAX_PLACED_PHOTOS_ASKED
      ) {
        const batch = digests.slice(start, start + MAX_PLACED_PHOTOS_ASKED);
        getPlacedPhotos({ data: { experiment, digests: batch } }).then(
          (placed) => {
            const found = new Map(placed.map((photo) => [photo.digest, photo]));
            settle(batch, (digest) => found.get(digest) ?? null);
          },
          () =>
            settle(batch, (_, previous) =>
              previous === "checking" ? "failed" : previous!,
            ),
        );
      }
    },
    [experiment],
  );
  const check = useCallback((digest: string) => ask([digest]), [ask]);
  const of = (digests: readonly string[]) => {
    const failed = digests.filter((digest) => answers.get(digest) === "failed");
    return {
      photos: digests.flatMap((digest) => {
        const answer = answers.get(digest);
        return typeof answer === "object" && answer !== null ? [answer] : [];
      }),
      checking: digests.some((digest) => answers.get(digest) === "checking"),
      failed: failed.length > 0,
      retry: () => ask(failed),
    };
  };
  return { check, of };
}

/** The drop zone of an observation's photographs, each with the unit it shows. */
export function ObservationPhotosField({
  photos,
  disabled,
}: {
  photos: ObservationPhotos;
  disabled: boolean;
}) {
  const { uploads, units, assigned, conflicts, chosen } = photos;
  return (
    <>
      <ImageDropZone
        images={uploads.images}
        onAdd={uploads.add}
        onRemove={uploads.remove}
        disabled={disabled}
        annotate={(image) => {
          const conflict = conflicts.get(image.id);
          if (conflict) return <ConflictTag conflict={conflict} />;
          return (
            <UnitChoice
              image={image}
              units={units}
              unavailable={
                new Set([
                  ...assigned,
                  ...[...chosen]
                    .filter(([id]) => id !== image.id)
                    .map(([, unit]) => unit),
                ])
              }
              value={chosen.get(image.id) ?? null}
              disabled={disabled}
              onChange={(unit) => photos.choose(image.id, unit)}
            />
          );
        }}
      />
      {photos.checkFailed ? (
        <Alert
          type="error"
          title={m.observation_photos_check_failed()}
          action={
            <Button size="small" disabled={disabled} onClick={photos.recheck}>
              {m.retry_action()}
            </Button>
          }
        />
      ) : null}
      {photos.conflicts.size > 0 ? (
        <Alert
          type="warning"
          title={m.observation_photos_conflicting({
            count: photos.conflicts.size,
          })}
        />
      ) : null}
      {photos.unmatched > 0 ? (
        <Alert
          type="warning"
          title={m.observation_photos_remaining({ count: photos.unmatched })}
          action={
            <Button
              size="small"
              disabled={disabled || photos.vacant <= 0}
              onClick={photos.fillInOrder}
            >
              {m.observation_photos_fill_in_order()}
            </Button>
          }
        />
      ) : null}
    </>
  );
}

interface StoredPhoto {
  id: number;
  digest: string;
  filename: string;
}

/**
 * The unit each free photograph goes to: the reader's choice where there is
 * one and the unit can still take it, otherwise the unit its file name
 * suggests, unless an earlier photograph already holds that unit.
 */
function matchPhotos(
  free: readonly StoredPhoto[],
  choices: Readonly<Record<number, string | null>>,
  vacantUnits: readonly PhotoUnit[],
): Map<number, string> {
  const claimed = new Set(free.flatMap((photo) => choices[photo.id] ?? []));
  const codes = vacantUnits.map((unit) => unit.code);
  const matched = new Map<number, string>();
  for (const photo of free) {
    if (photo.id in choices) {
      const unit = choices[photo.id];
      if (unit && vacantUnits.some((item) => item.id === unit)) {
        matched.set(photo.id, unit);
      }
      continue;
    }
    const code = suggestUnit(photo.filename, codes);
    const unit = vacantUnits.find((item) => item.code === code);
    if (!unit || claimed.has(unit.id)) continue;
    claimed.add(unit.id);
    matched.set(photo.id, unit.id);
  }
  return matched;
}

export function storedPhotos(images: readonly ListedImage[]): StoredPhoto[] {
  return images.flatMap((image) =>
    image.state.status === "stored"
      ? [
          {
            id: image.id,
            digest: image.state.digest,
            filename: image.file.name,
          },
        ]
      : [],
  );
}

/** Where a photograph already is, in place of the unit it cannot take. */
function ConflictTag({ conflict }: { conflict: PhotoConflict }) {
  return (
    <Tag color="warning" size="small">
      {conflict.kind === "placed"
        ? m.observation_photos_placed({
            unit: conflict.placed.unit,
            day: formatDay(conflict.placed.observedOn),
          })
        : m.observation_photos_repeated({ file: conflict.filename })}
    </Tag>
  );
}

/** The unit a stored photograph shows; clearing it leaves the photograph unmatched. */
function UnitChoice({
  image,
  units,
  unavailable,
  value,
  disabled,
  onChange,
}: {
  image: ListedImage;
  units: readonly PhotoUnit[];
  unavailable: ReadonlySet<string>;
  value: string | null;
  disabled: boolean;
  onChange: (unit: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <Select
      aria-label={m.observation_photos_unit_label({ file: image.file.name })}
      className="w-28 mobile:w-44"
      size="small"
      variant="filled"
      allowClear
      disabled={disabled}
      placeholder={m.observation_photos_unmatched()}
      options={units.map((unit) => ({
        label: unit.code,
        value: unit.id,
        disabled: unavailable.has(unit.id),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}
