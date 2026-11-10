import type { CalendarDay } from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { CountedClassesField } from "../models/CountedClassesField";
import { DayField } from "./DayField";
import { ModelField } from "./ModelField";

/** What a page of the notebook says about a day, apart from its photographs. */
export interface ObservationValue {
  observedOn: CalendarDay;
  modelId: string;
  countedClasses: string[];
  note: string;
}

export function ObservationFields({
  value,
  onChange,
  inoculatedOn,
  taken,
  models,
  disabled,
}: {
  value: ObservationValue;
  onChange: (value: ObservationValue) => void;
  inoculatedOn: CalendarDay;
  /** The days other observations already hold. */
  taken: readonly CalendarDay[];
  models: readonly Model[];
  disabled: boolean;
}) {
  const modelOf = (id: string) => models.find((model) => model.id === id)!;
  return (
    <>
      <DayField
        label={m.observation_date_label()}
        disabled={disabled}
        value={value.observedOn}
        earliest={{
          day: inoculatedOn,
          error: m.observation_before_inoculation(),
        }}
        taken={{ days: taken, error: m.observation_day_taken() }}
        onChange={(observedOn) => onChange({ ...value, observedOn })}
      />
      <ModelField
        disabled={disabled}
        models={models}
        value={value.modelId}
        // Another model recognizes other classes, so the day counts the ones
        // that model counts until told otherwise.
        onChange={(modelId) =>
          onChange({
            ...value,
            modelId,
            countedClasses: modelOf(modelId).countedClasses,
          })
        }
      />
      <CountedClassesField
        label={m.observation_counted_classes_label()}
        desc={m.observation_counted_classes_description()}
        disabled={disabled}
        model={modelOf(value.modelId)}
        value={value.countedClasses}
        onChange={(countedClasses) => onChange({ ...value, countedClasses })}
      />
      <Form.Field label={m.note_label()}>
        <Input
          disabled={disabled}
          value={value.note}
          onValueChange={(note) => onChange({ ...value, note })}
        />
      </Form.Field>
    </>
  );
}
