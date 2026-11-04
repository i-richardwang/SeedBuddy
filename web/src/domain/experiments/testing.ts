import type { CultureEvent } from "./culture-events";
import type {
  ExperimentGridDetail,
  ExperimentSheetDetail,
  ExperimentSummary,
  ObservationImageCell,
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
export function grid(
  overrides: Partial<ExperimentGridDetail> = {},
): ExperimentGridDetail {
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
export function cell<T extends ExperimentSheetDetail | ExperimentSummary>(
  source: T,
  subject: string,
  day: ExperimentObservation,
): T["cells"][number] {
  const found = source.cells.find(
    (cell) =>
      ("unit" in cell ? cell.unit : cell.treatment) === subject &&
      cell.observation === day.id,
  );
  if (!found) throw new Error(`No cell for ${subject} on ${day.id}`);
  return found;
}
