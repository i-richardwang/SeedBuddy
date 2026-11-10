import type {
  BaselineGap,
  UnitBaseline,
} from "../../domain/experiments/read-model";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { Text } from "../../ui/kit/Text";
import { Tooltip } from "../../ui/kit/Tooltip";
import { formatCount } from "../../ui/numbers";
import { observationLabel } from "./labels";

const BASELINE_GAP_LABELS = {
  unread: m.unit_baseline_gap_unread,
  unclear: m.unit_baseline_gap_unclear,
  event: m.unit_baseline_gap_event,
  model: m.unit_baseline_gap_model,
} as const satisfies Record<BaselineGap, () => string>;

/** Why a baseline has no number, in a few words. */
export function baselineGapLabel(gap: BaselineGap): string {
  return BASELINE_GAP_LABELS[gap]();
}

/**
 * What a unit's rates are taken over, read like a day's count: a number a
 * person stands behind is shown plain and one nobody has reviewed yet
 * provisional. A line under it names the observation where the unit names
 * one. A baseline a rate waits on asks for attention, in its color and by
 * name, with the observation and why it gave no number under it; one nothing
 * waits on is only absent.
 */
export function UnitBaselineValue({
  baseline,
  observations,
}: {
  baseline: UnitBaseline | null;
  observations: readonly ExperimentObservation[];
}) {
  if (!baseline) return <Absent />;
  const { named, wanted } = baseline;
  if (baseline.count === null && !wanted && !named) return <Absent />;
  const observation = observations.find(
    (item) => item.id === baseline.observation,
  );
  const day = observation ? observationLabel(observation) : "";
  const byPerson = baseline.source === "review" || baseline.source === "manual";
  const caption =
    baseline.gap !== null
      ? m.unit_baseline_gap_on({ day, gap: baselineGapLabel(baseline.gap) })
      : named
        ? day
        : null;
  const notes = [
    ...(wanted ? [m.unit_baseline_wanted()] : []),
    ...(named ? [m.unit_baseline_named({ day })] : []),
  ];
  const value = (
    <span className="inline-flex flex-col items-start">
      <Text
        as="span"
        type={wanted ? "warning" : byPerson ? undefined : "tertiary"}
        weight={wanted || byPerson ? "medium" : undefined}
        className="tabular-nums"
      >
        {baseline.count === null ? (
          wanted ? (
            m.unit_baseline_missing()
          ) : (
            <Absent />
          )
        ) : (
          formatCount(baseline.count)
        )}
      </Text>
      {caption ? (
        <Text as="span" size="xs" type="tertiary" weight="regular">
          {caption}
        </Text>
      ) : null}
    </span>
  );
  if (notes.length === 0) return value;
  return (
    <Tooltip
      title={
        <span className="flex max-w-xs flex-col">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      }
    >
      {value}
    </Tooltip>
  );
}
