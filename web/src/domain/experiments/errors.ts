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

export class ExperimentRejectedError extends ConflictError {
  readonly code = "experiment_rejected";
}
export class ExperimentHasRecordsError extends ConflictError {
  readonly code = "experiment_has_records";
}
export class ImagesNotStoredError extends ConflictError {
  readonly code = "images_not_stored";
}
export class ObservationRejectedError extends ConflictError {
  readonly code = "observation_rejected";
}
export class ObservationModelHasCountsError extends ConflictError {
  readonly code = "observation_model_has_counts";
}

export class TreatmentRejectedError extends ConflictError {
  readonly code = "treatment_rejected";
}
export class UnitRejectedError extends ConflictError {
  readonly code = "unit_rejected";
}
export class ObservationImageRejectedError extends ConflictError {
  readonly code = "observation_image_rejected";
}
export class ManualReadingRejectedError extends ConflictError {
  readonly code = "manual_reading_rejected";
}

/** The photographs a refused assignment would have placed a second time. */
export const imageAlreadyUsedDetailsSchema = z.strictObject({
  images: z.array(placedPhotoSchema).min(1),
});

export class ExperimentObservationImageAlreadyUsedError extends ConflictError {
  readonly code = "experiment_observation_image_already_used";
  override get details() {
    return imageAlreadyUsedDetailsSchema.parse({ images: this.images });
  }
  constructor(public readonly images: PlacedPhoto[]) {
    const [first] = images;
    super(
      first
        ? `${first.filename} already represents unit ${first.unit} on ${first.observedOn}`
        : "An image was already used in this experiment",
    );
  }
}
