import { identifierLabel } from "../../domain/identifiers/schema";
import type { ModelVersion } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";

const VERSION_SOURCE_LABELS = {
  builtin: m.version_source_builtin,
  import: m.version_source_import,
  training_run: m.version_source_training,
} as const satisfies Record<
  ModelVersion["source"]["kind"],
  (...args: never[]) => string
>;
export function versionSourceLabel(source: ModelVersion["source"]): string {
  return source.kind === "training_run"
    ? VERSION_SOURCE_LABELS.training_run({
        run: identifierLabel(source.trainingRunId),
      })
    : VERSION_SOURCE_LABELS[source.kind]();
}
