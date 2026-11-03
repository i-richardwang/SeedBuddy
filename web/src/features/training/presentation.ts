import { identifierLabel } from "../../domain/identifiers/schema";
import { bestEpoch } from "../../domain/training/metrics";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  isTrainingRunActive,
  isTrainingRunResumable,
} from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import { runPlacement } from "./placement";

/** The score and provenance a run leads with, including any resumable checkpoint. */
export function trainingRunPresentation({
  run,
  epochs,
  version,
}: TrainingRunDetail) {
  const best = bestEpoch(epochs);
  const published =
    version && version.artifact.kind === "ultralytics" ? version : null;
  const lead = published
    ? m.training_kpi_published({ version: identifierLabel(published.id) })
    : best
      ? m.epoch_label({ epoch: best.epoch })
      : null;
  const saved =
    run.checkpoint && (isTrainingRunActive(run) || isTrainingRunResumable(run))
      ? m.training_kpi_saved({ epoch: run.checkpoint.epoch })
      : null;
  return {
    best,
    published,
    total: run.recipe.parameters.epochs,
    placement: runPlacement(run),
    facts: [lead, saved].filter((fact) => fact !== null),
  };
}
