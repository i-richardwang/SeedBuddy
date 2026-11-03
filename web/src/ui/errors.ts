import { type BusinessFailure, businessFailureSchema } from "../domain/errors";
import { imageAlreadyUsedDetailsSchema } from "../domain/experiments/errors";
import { m } from "../paraglide/messages";
import { formatDay } from "./Day";
import { formatList } from "./lists";

type Label = (details: BusinessFailure["details"]) => string | null;

const BUSINESS_ERROR_LABELS: ReadonlyMap<string, Label> = new Map<
  string,
  Label
>([
  ["training_run_conflict", () => m.error_training_conflict()],
  ["training_artifact_invalid", () => m.error_training_artifact()],
  ["dataset_model_mismatch", () => m.error_dataset_model()],
  ["model_id_taken", () => m.error_model_id_taken()],
  ["model_in_use", () => m.error_model_in_use()],
  ["experiment_observation_image_already_used", imageAlreadyUsed],
  [
    "observation_model_has_counts",
    () => m.error_observation_model_has_counts(),
  ],
  ["experiment_has_records", () => m.error_experiment_has_records()],
  ["user_invalid", () => m.error_user_rejected()],
  ["worker_name_taken", () => m.error_worker_name_taken()],
]);

function imageAlreadyUsed(details: BusinessFailure["details"]): string | null {
  const parsed = imageAlreadyUsedDetailsSchema.safeParse(details);
  if (!parsed.success) return null;
  const images = formatList(
    parsed.data.images.map((image) =>
      m.error_image_already_used_item({
        file: image.filename,
        unit: image.unit,
        day: formatDay(image.observedOn),
      }),
    ),
  );
  return m.error_image_already_used({ images });
}

/**
 * RPC failures are validated data, never reconstructed Error subclasses. A
 * refusal says what stood in the way when its details name it.
 */
export function errorMessage(error: unknown): string {
  const failure = businessFailureSchema.safeParse(error);
  if (failure.success) {
    const { code, category, details } = failure.data;
    const label = BUSINESS_ERROR_LABELS.get(code)?.(details);
    if (label) return label;
    return {
      not_found: m.error_not_found,
      conflict: m.error_conflict,
      invalid_request: m.error_invalid_request,
    }[category]();
  }
  return error instanceof Error ? error.message : String(error);
}
