import type {
  TrainingAttempt,
  TrainingRun,
} from "../../domain/training/schema";
import { Status, type StatusProps } from "../../ui/kit/Status";
import {
  trainingAttemptIcon,
  trainingAttemptLabel,
  trainingAttemptTone,
  trainingRunIcon,
  trainingRunLabel,
  trainingRunTone,
} from "./labels";

/**
 * A run's status; a running run names its phase and its glyph turns. Other
 * props reach the status, so it can be a tooltip trigger.
 */
export function TrainingRunState({
  run,
  ...props
}: { run: TrainingRun } & Omit<
  StatusProps,
  "children" | "tone" | "icon" | "spin"
>) {
  const { state } = run;
  return (
    <Status
      {...props}
      tone={trainingRunTone(run)}
      icon={trainingRunIcon(run)}
      spin={state.status === "running"}
    >
      {trainingRunLabel(run)}
    </Status>
  );
}

/**
 * How one attempt ended, in the looks of the run's own statuses; an attempt
 * still under way reads as in progress and its glyph turns.
 */
export function TrainingAttemptState({
  outcome,
}: {
  outcome: TrainingAttempt["outcome"];
}) {
  return (
    <Status
      tone={trainingAttemptTone(outcome)}
      icon={trainingAttemptIcon(outcome)}
      spin={outcome === null}
    >
      {trainingAttemptLabel(outcome)}
    </Status>
  );
}
