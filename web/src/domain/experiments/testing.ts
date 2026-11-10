import type { CultureEvent } from "./culture-events";
import type {
  ExperimentRecords,
  ObservationImageCell,
  SheetCell,
  SheetRow,
} from "./read-model";
import type { ExperimentObservation, ManualReading } from "./schema";

export function observation(
  ordinal: number,
  counted = ["ungerminated", "germinated"],
  modelId = "seed-detector",
): ExperimentObservation {
  return {
    id: `day-${ordinal}`,
    ordinal,
    observedOn: `2026-09-0${ordinal}`,
    note: "",
    modelId,
    countedClasses: counted,
    hasRecords: true,
  };
}
export function photograph(
  unit: string,
  day: ExperimentObservation | string,
  overrides: Partial<ObservationImageCell> = {},
): ObservationImageCell {
  const observation = typeof day === "string" ? day : day.id;
  return {
    id: `${unit}-${observation}`,
    unit,
    observation,
    digest: "a".repeat(64),
    filename: `${unit}.jpg`,
    state: "analyzed",
    detectionTally: null,
    detectionUnfound: [],
    proposalTally: null,
    annotationTally: null,
    error: null,
    unclear: false,
    ...overrides,
  };
}
export function counted(
  unit: string,
  day: ExperimentObservation | string,
  tally: ManualReading["tally"],
): ManualReading {
  return {
    unit,
    observation: typeof day === "string" ? day : day.id,
    tally,
    recordedAt: "2026-09-08T00:00:00.000Z",
  };
}
export function event(
  type: CultureEvent["type"],
  day: ExperimentObservation,
): CultureEvent {
  return {
    id: `${type}-${day.id}`,
    type,
    observation: day.id,
    recordedAt: "2026-09-01T00:00:00.000Z",
  };
}
export function records(
  overrides: Partial<ExperimentRecords> = {},
): ExperimentRecords {
  return {
    experiment: {
      id: "experiment",
      name: "Experiment",
      plantMaterial: "",
      explantType: "",
      baseMedium: "",
      notes: "",
      inoculatedOn: "2026-08-01",
      countsUnclear: false,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    treatments: [],
    units: [],
    observations: [],
    images: [],
    manualReadings: [],
    ...overrides,
  };
}
/** The unit's cell among `rows` on `day`. */
export function rowCell(
  rows: readonly SheetRow[],
  unit: string,
  day: ExperimentObservation | string,
): SheetCell {
  const observation = typeof day === "string" ? day : day.id;
  const found = rows
    .find((row) => row.unit.id === unit)
    ?.cells.find((cell) => cell.observation === observation);
  if (!found) throw new Error(`No cell for ${unit} on ${observation}`);
  return found;
}
