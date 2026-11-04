import {
  cellKey,
  imageReview,
  observationCells,
} from "../../domain/experiments/cell-reading";
import type { UnitDetail } from "../../domain/experiments/read-model";
import type { UnitRef } from "../../domain/experiments/schema";
import { readExperimentRecord } from "../experiments/public";
import { type Executor, inSnapshot } from "../infra/db/client";
import { readGrid } from "./experiment-grid";
import { experimentObservationImageDetail } from "./experiment-observation-image-detail";

export function unitDetail(
  ref: UnitRef,
  observationId?: string,
  db?: Executor,
): Promise<UnitDetail | null> {
  return inSnapshot(db, (db) => readUnitSeries(ref, observationId, db));
}

async function readUnitSeries(
  ref: UnitRef,
  observationId: string | undefined,
  db: Executor,
): Promise<UnitDetail | null> {
  const experiment = await readExperimentRecord(ref.experiment, db);
  if (!experiment) return null;
  const { grid, images: sizedImages } = await readGrid(experiment, db);
  const { treatments, units, observations, images, manualReadings } = grid;
  const unit = units.find((item) => item.id === ref.unit);
  if (!unit) return null;
  const cells = observationCells(images, manualReadings);
  const own = observations.map((observation) => ({
    observation,
    cell: cells.get(cellKey(unit.id, observation.id)),
  }));
  const series = own.map(({ observation, cell }) => ({
    observation,
    image:
      sizedImages.find(
        (image) =>
          image.unit === unit.id && image.observation === observation.id,
      ) ?? null,
    manual: cell?.manual ?? null,
  }));
  const viewing =
    observationId === undefined
      ? [...series].reverse().find((item) => item.image !== null)
      : series.find((item) => item.observation.id === observationId);
  if (observationId !== undefined && !viewing) return null;
  const shown = viewing?.image
    ? await experimentObservationImageDetail(
        {
          experiment: ref.experiment,
          observationImage: viewing.image.id,
        },
        db,
      )
    : null;
  return {
    experiment,
    unit,
    treatments,
    navigation: units.map(({ id, code, treatment }) => {
      const image =
        viewing && cells.get(cellKey(id, viewing.observation.id))?.image;
      return { id, code, treatment, image: image ? imageReview(image) : null };
    }),
    observations: series,
    observation: viewing?.observation.id ?? null,
    shown,
  };
}
