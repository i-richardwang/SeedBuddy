import { FolderInput } from "lucide-react";
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
import type {
  CalendarDay,
  PhotoSlotsRequest,
  UnitPhoto,
} from "../../domain/experiments/schema";
import type { PhotoBatchOverview } from "../../domain/photos/read-model";
import { getPhotoSlots, getPlacedPhotos } from "../../functions/experiments";
import { getPhotoBatchDetail, getPhotoBatches } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { found } from "../../ui/found";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { DropdownMenu } from "../../ui/kit/DropdownMenu";
import { Select } from "../../ui/kit/Select";
import { Tag } from "../../ui/kit/Tag";
import { ImageDropZone } from "../upload/ImageDropZone";
import {
  type PhotoOnHand,
  type StoredOnHand,
  storedOnHand,
} from "../upload/photos-on-hand";
import {
  type PhotosOnHandView,
  usePhotosOnHand,
} from "../upload/usePhotosOnHand";

/**
 * What placing a day's photographs is read with: the units the day's
 * photographs go to, and the reader's batches of photographs still waiting.
 */
export interface PhotoPlacing {
  slots: PhotoSlots;
  batches: PhotoBatchOverview[];
}

/** Reads what placing photographs needs, when the dialog that places them opens. */
export async function readPhotoPlacing(
  request: PhotoSlotsRequest,
): Promise<PhotoPlacing> {
  const [slots, batches] = await Promise.all([
    getPhotoSlots({ data: request }),
    getPhotoBatches(),
  ]);
  return { slots: found(slots), batches };
}

/** A unit a photograph is matched to, by its code. */
type PhotoUnit = Pick<PhotoSlot, "id" | "code">;

/** The photographs on hand for one observation day, each matched to its unit. */
interface ObservationPhotos {
  /** The photographs to place: those uploaded here and those taken from batches. */
  onHand: PhotosOnHandView;
  /** The reader's batches that hold photographs to place. */
  batches: readonly PhotoBatchOverview[];
  /** Takes a batch's waiting photographs on hand, to be matched like uploaded ones. */
  addBatch: (batch: string) => void;
  /** Whether a batch's photographs are being read. */
  addingBatch: boolean;
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
 * Uploads the photographs of one observation day, or takes them from the
 * reader's batches, and matches each to its unit: the reader's choice where
 * there is one, otherwise the unit its file name suggests, or the shooting
 * order on request. A photograph the experiment already holds cannot be
 * placed again.
 */
export function useObservationPhotos({
  experiment,
  placing: { slots, batches },
  day,
}: {
  experiment: string;
  placing: PhotoPlacing;
  /** The day photographed, which decides the units still on the bench. */
  day: CalendarDay;
}): ObservationPhotos {
  const units = slots.units.filter((unit) => onBenchOn(unit.leftOn, day));
  const assigned = new Set(slots.taken);
  const placed = usePlacedPhotos(experiment);
  const onHand = usePhotosOnHand({ onStored: placed.check });
  const adding = useAsyncAction();
  const [choices, setChoices] = useState<Record<number, string | null>>({});
  const vacantUnits = units.filter((unit) => !assigned.has(unit.id));
  const stored = storedOnHand(onHand.photos);
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
    onHand,
    batches: batches.filter((batch) => batch.photoCount > 0),
    addBatch: (batch) =>
      void adding.run(
        async () => {
          const detail = found(await getPhotoBatchDetail({ data: { batch } }));
          onHand.take(detail.photos);
        },
        m.observation_photos_batch_not_added(),
        { invalidate: false },
      ),
    addingBatch: adding.busy,
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
      onHand.storing ||
      onHand.failed ||
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
  return { check: ask, of };
}

/** The drop zone of an observation's photographs, each with the unit it shows. */
export function ObservationPhotosField({
  photos,
  disabled,
}: {
  photos: ObservationPhotos;
  disabled: boolean;
}) {
  const { onHand, units, assigned, conflicts, chosen } = photos;
  return (
    <>
      {photos.batches.length > 0 ? (
        <div className="flex justify-end">
          <DropdownMenu
            align="end"
            disabled={disabled}
            items={photos.batches.map((batch) => ({
              key: batch.id,
              label: m.observation_photos_batch_item({
                batch: batch.name,
                count: batch.photoCount,
              }),
              onClick: () => photos.addBatch(batch.id),
            }))}
          >
            <Button
              size="small"
              icon={FolderInput}
              loading={photos.addingBatch}
            >
              {m.observation_photos_from_batch()}
            </Button>
          </DropdownMenu>
        </div>
      ) : null}
      <ImageDropZone
        photos={onHand.photos}
        onUpload={onHand.upload}
        onRemove={onHand.remove}
        disabled={disabled}
        annotate={(photo) => {
          const conflict = conflicts.get(photo.id);
          if (conflict) return <ConflictTag conflict={conflict} />;
          return (
            <UnitChoice
              photo={photo}
              units={units}
              unavailable={
                new Set([
                  ...assigned,
                  ...[...chosen]
                    .filter(([id]) => id !== photo.id)
                    .map(([, unit]) => unit),
                ])
              }
              value={chosen.get(photo.id) ?? null}
              disabled={disabled}
              onChange={(unit) => photos.choose(photo.id, unit)}
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

/**
 * The unit each free photograph goes to: the reader's choice where there is
 * one and the unit can still take it, otherwise the unit its file name
 * suggests, unless an earlier photograph already holds that unit.
 */
function matchPhotos(
  free: readonly StoredOnHand[],
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
  photo,
  units,
  unavailable,
  value,
  disabled,
  onChange,
}: {
  photo: PhotoOnHand;
  units: readonly PhotoUnit[];
  unavailable: ReadonlySet<string>;
  value: string | null;
  disabled: boolean;
  onChange: (unit: string | null) => void;
}) {
  if (photo.state.status !== "stored") return null;
  return (
    <Select
      aria-label={m.observation_photos_unit_label({ file: photo.filename })}
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
