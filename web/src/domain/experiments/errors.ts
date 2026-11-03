import { z } from "zod";

import { ConflictError, NotFoundError } from "../errors";
import { type PlacedPhoto, placedPhotoSchema } from "./photos";

export class ExperimentNotFoundError extends NotFoundError {
  readonly code = "experiment_not_found";
}
export class ExperimentObservationImageNotFoundError extends NotFoundError {
  readonly code = "experiment_observation_image_not_found";
}
export class ObservationNotFoundError extends NotFoundError {
  readonly code = "observation_not_found";
}
export class TreatmentNotFoundError extends NotFoundError {
  readonly code = "treatment_not_found";
}
export class UnitNotFoundError extends NotFoundError {
  readonly code = "unit_not_found";
}
export class CultureEventNotFoundError extends NotFoundError {
  readonly code = "culture_event_not_found";
}

export class ExperimentNameTakenError extends ConflictError {
  readonly code = "experiment_name_taken";
}
export class ExperimentRecordsConflictError extends ConflictError {
  readonly code = "experiment_records_conflict";
}
export class ImageStorageConflictError extends ConflictError {
  readonly code = "image_storage_conflict";
}
export class ObservationConflictError extends ConflictError {
  readonly code = "observation_conflict";
}
export class ObservationModelCountsConflictError extends ConflictError {
  readonly code = "observation_model_counts_conflict";
}

export class TreatmentNameTakenError extends ConflictError {
  readonly code = "treatment_name_taken";
}
export class TreatmentConflictError extends ConflictError {
  readonly code = "treatment_conflict";
}
export class UnitConflictError extends ConflictError {
  readonly code = "unit_conflict";
}
/** The requested image assignment conflicts with the observation or unit state. */
export class ObservationImageConflictError extends ConflictError {
  readonly code = "observation_image_conflict";
}
export class ManualReadingConflictError extends ConflictError {
  readonly code = "manual_reading_conflict";
}

/** The photographs a refused assignment would have placed a second time. */
export const imageAlreadyUsedDetailsSchema = z.strictObject({
  images: z.array(placedPhotoSchema).min(1),
});

/** The same photograph already represents a unit in this experiment. */
export class ExperimentObservationImageConflictError extends ConflictError {
  readonly code = "experiment_observation_image_conflict";
  override get details() {
    return imageAlreadyUsedDetailsSchema.parse({ images: this.images });
  }
  constructor(public readonly images: PlacedPhoto[]) {
    const first = images[0]!;
    super(
      `${first.filename} already represents unit ${first.unit} on ${first.observedOn}`,
    );
  }
}

export class UnitNameTakenError extends ConflictError {
  readonly code = "unit_name_taken";
}
