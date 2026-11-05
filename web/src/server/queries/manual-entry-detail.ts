import { cellReadingFromImage } from "../../domain/experiments/cell-reading";
import { unitIsOnBench } from "../../domain/experiments/culture-events";
import type { ManualEntryRow } from "../../domain/experiments/read-model";
import type { ObservationRef } from "../../domain/experiments/schema";
import { listManualReadings, listUnits } from "../experiments/public";
import { snapshot } from "../infra/db/client";
import { experimentDesign } from "./experiment-design";
import { listImageCells } from "./experiment-records";

/**
 * One treatment's units on the bench on the observation, in the
 * experiment's order, as counts are entered for them: what each one's
 * photograph of the day reads, and the count already entered. Nothing for
 * an unknown experiment, observation or treatment.
 */
export function manualEntryDetail(
  ref: ObservationRef & { treatment: string },
): Promise<ManualEntryRow[] | null> {
  return snapshot(async (db) => {
    const design = await experimentDesign(ref.experiment, db);
    const observation = design?.observations.find(
      (item) => item.id === ref.observation,
    );
    if (
      !design ||
      !observation ||
      !design.treatments.some((item) => item.id === ref.treatment)
    )
      return null;
    const units = { treatment: ref.treatment };
    const scope = { units, observation: observation.id };
    const [listed, images, manualReadings] = await Promise.all([
      listUnits(ref.experiment, db, units),
      listImageCells(ref.experiment, db, scope),
      listManualReadings(ref.experiment, db, scope),
    ]);
    const photographs = new Map(images.map((image) => [image.unit, image]));
    const entered = new Map(manualReadings.map((item) => [item.unit, item]));
    return listed
      .filter((unit) =>
        unitIsOnBench(unit.events, design.observations, observation),
      )
      .map((unit) => ({
        unit: { id: unit.id, code: unit.code },
        photographed: cellReadingFromImage(
          photographs.get(unit.id),
          observation,
        ),
        manual: entered.get(unit.id) ?? null,
      }));
  });
}
