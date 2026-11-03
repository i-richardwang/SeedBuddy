import { useState } from "react";

import { pairInOrder, suggestUnit } from "../../domain/experiments/naming";
import {
  type PhotoConflict,
  type PlacedPhoto,
  photoConflicts,
} from "../../domain/experiments/photos";
import type { Unit } from "../../domain/experiments/read-model";
import type { UnitPhoto } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { Select } from "../../ui/kit/Select";
import { Tag } from "../../ui/kit/Tag";
import { ImageDropZone } from "../upload/ImageDropZone";
import type { ListedImage } from "../upload/state";
import { type Uploads, useUploads } from "../upload/useUploads";

/** Photographs being uploaded for one observation day and matched to its units. */
export interface ObservationPhotos {
  uploads: Uploads;
  units: readonly Unit[];
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
  /** Still uploading, a photograph failed to upload, is already used, or has no unit. */
  pending: boolean;
}

/**
 * Uploads the photographs of one observation day and matches each to its
 * unit: the reader's choice where there is one, otherwise the unit its file
 * name suggests, or the shooting order on request. A photograph the
 * experiment already holds cannot be placed again.
 */
export function useObservationPhotos({
  units,
  assigned,
  placed,
}: {
  /** The units that can be photographed that day. */
  units: readonly Unit[];
  assigned: ReadonlySet<string>;
  /** The photographs the experiment already holds. */
  placed: readonly PlacedPhoto[];
}): ObservationPhotos {
  const uploads = useUploads();
  const [choices, setChoices] = useState<Record<number, string | null>>({});
  const vacantUnits = units.filter((unit) => !assigned.has(unit.id));
  const stored = storedPhotos(uploads.images);
  const conflicts = photoConflicts(stored, placed);
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
    pending:
      uploads.storing || uploads.failed || conflicts.size > 0 || unmatched > 0,
  };
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
      {photos.conflicts.size > 0 ? (
        <Alert
          type="warning"
          title={m.observation_images_conflicting({
            count: photos.conflicts.size,
          })}
        />
      ) : null}
      {photos.unmatched > 0 ? (
        <Alert
          type="warning"
          title={m.observation_images_remaining({ count: photos.unmatched })}
          action={
            <Button
              size="small"
              disabled={disabled || photos.vacant <= 0}
              onClick={photos.fillInOrder}
            >
              {m.observation_images_fill_in_order()}
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
  vacantUnits: readonly Unit[],
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

function storedPhotos(images: readonly ListedImage[]): StoredPhoto[] {
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
        ? m.observation_images_placed({
            unit: conflict.placed.unit,
            day: formatDay(conflict.placed.observedOn),
          })
        : m.observation_images_repeated({ file: conflict.filename })}
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
  units: readonly Unit[];
  unavailable: ReadonlySet<string>;
  value: string | null;
  disabled: boolean;
  onChange: (unit: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <Select
      aria-label={m.observation_images_unit_label({ file: image.file.name })}
      className="w-28 mobile:w-44"
      size="small"
      variant="filled"
      allowClear
      disabled={disabled}
      placeholder={m.observation_images_unassigned()}
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
