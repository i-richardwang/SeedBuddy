import { useState } from "react";

import { firstObservation } from "../../domain/experiments/analysis";
import type { BaselineDay } from "../../domain/experiments/read-model";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { updateUnitBaselines } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { toast } from "../../ui/kit/Toast";
import { formatCount } from "../../ui/numbers";
import { observationLabel } from "./labels";
import { baselineGapLabel } from "./UnitBaseline";
import { choiceSelection, type UnitChoice, unlessChanged } from "./unit-choice";

const FORM_ID = "unit-baseline";

/**
 * Names the observation the chosen units' rates are taken against: the
 * experiment's first unless a person names another, as where the first
 * photograph cannot be read and a later one still shows every individual.
 * An observation read for another model than the first gives no baseline and
 * is not offered. For one unit, `days` says what each observation would
 * give, so the choice is made on the numbers.
 */
export function UnitBaselineDialog({
  experiment,
  choice,
  observations,
  days,
  open,
  onClose,
  onDone,
}: {
  experiment: string;
  choice: UnitChoice;
  /** The experiment's observations in its order, one at least. */
  observations: ExperimentObservation[];
  /** What the one unit chosen would take its rates over on each observation, were it to name it. */
  days?: ReadonlyMap<string, BaselineDay>;
  open: boolean;
  onClose: () => void;
  /** After the baseline was named, or the units chosen were found changed. */
  onDone: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.unit_baseline()}
      okText={m.save_action()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <BaselineForm
        experiment={experiment}
        choice={choice}
        observations={observations}
        days={days}
        action={action}
        onDone={onDone}
      />
    </FormDialog>
  );
}

/** An observation as the dialog offers it: its day, marked when it is the first, and what it would give. */
export function optionLabel(
  observation: ExperimentObservation,
  first: ExperimentObservation,
  days: ReadonlyMap<string, BaselineDay> | undefined,
): string {
  const day =
    observation.id === first.id
      ? m.unit_baseline_first({ day: observationLabel(observation) })
      : observationLabel(observation);
  const baseline = days?.get(observation.id);
  const detail =
    observation.modelId !== first.modelId
      ? baselineGapLabel("model")
      : baseline?.gap
        ? baselineGapLabel(baseline.gap)
        : baseline?.count != null
          ? formatCount(baseline.count)
          : null;
  return detail === null ? day : m.unit_baseline_option({ day, detail });
}

/** Proposes the observation the units chosen one by one all name, or else the first. */
function BaselineForm({
  experiment,
  choice,
  observations,
  days,
  action,
  onDone,
}: {
  experiment: string;
  choice: UnitChoice;
  observations: ExperimentObservation[];
  days: ReadonlyMap<string, BaselineDay> | undefined;
  action: AsyncAction;
  onDone: () => void;
}) {
  const earliest = firstObservation(observations)!;
  const first = earliest.id;
  const [observation, setObservation] = useState(() => {
    if (!("units" in choice)) return first;
    const [unit, ...others] = choice.units;
    const named = unit?.baseline ?? null;
    return others.every((other) => other.baseline === named)
      ? (named ?? first)
      : first;
  });

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          () =>
            unlessChanged(
              updateUnitBaselines({
                data: {
                  experiment,
                  units: choiceSelection(choice),
                  // The first observation is what a unit that names none reads.
                  observation: observation === first ? null : observation,
                },
              }),
            ),
          m.unit_baseline_not_saved(),
          {
            onSuccess: (result) => {
              if (result === "changed") {
                toast.error({
                  title: m.unit_baseline_not_saved(),
                  description: m.culture_event_units_changed(),
                });
              } else {
                toast.success(m.unit_baseline_saved());
              }
              onDone();
            },
          },
        );
      }}
    >
      <Form.Field
        label={m.observation_label()}
        desc={m.unit_baseline_description()}
      >
        <Select
          disabled={action.busy}
          options={observations.map((item) => ({
            label: optionLabel(item, earliest, days),
            value: item.id,
            disabled: item.modelId !== earliest.modelId,
          }))}
          value={observation}
          onChange={setObservation}
        />
      </Form.Field>
    </Form>
  );
}
