import type { CalendarDay, Experiment } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Form } from "../../ui/kit/Form";
import { Input, TextArea } from "../../ui/kit/Input";
import { Switch } from "../../ui/kit/Switch";
import { DayField } from "./DayField";

type NotebookPage = Pick<
  Experiment,
  "name" | "plantMaterial" | "explantType" | "baseMedium" | "notes"
>;

export function readExperimentFields(form: FormData): NotebookPage {
  const text = (field: string) => String(form.get(field) ?? "");
  return {
    name: text("name"),
    plantMaterial: text("plantMaterial"),
    explantType: text("explantType"),
    baseMedium: text("baseMedium"),
    notes: text("notes"),
  };
}

/**
 * The notebook page of an experiment, read from the form by field name: its
 * name and free notes, then the culture it starts from as a section, and
 * last how its numbers are read.
 */
export function ExperimentFields({
  disabled,
  defaults,
  inoculatedOn,
  onInoculatedOnChange,
  countsUnclear,
  onCountsUnclearChange,
}: {
  disabled: boolean;
  defaults?: NotebookPage;
  inoculatedOn: CalendarDay;
  onInoculatedOnChange: (value: CalendarDay) => void;
  countsUnclear: boolean;
  onCountsUnclearChange: (value: boolean) => void;
}) {
  return (
    <>
      <Form.Field
        name="name"
        label={m.experiment_field_name()}
        required
        validate={(value) =>
          String(value ?? "").trim() === ""
            ? m.experiment_field_name_required()
            : null
        }
      >
        <Input
          disabled={disabled}
          defaultValue={defaults?.name}
          placeholder={m.experiment_field_name_placeholder()}
        />
      </Form.Field>
      <Form.Field name="notes" label={m.experiment_field_notes()}>
        <TextArea
          disabled={disabled}
          defaultValue={defaults?.notes}
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      </Form.Field>
      <Form.Group title={m.experiment_group_culture()}>
        <Form.Field
          name="plantMaterial"
          label={m.experiment_field_plant_material()}
        >
          <Input
            disabled={disabled}
            defaultValue={defaults?.plantMaterial}
            placeholder={m.experiment_field_plant_material_placeholder()}
          />
        </Form.Field>
        <Form.Field
          name="explantType"
          label={m.experiment_field_explant_type()}
        >
          <Input
            disabled={disabled}
            defaultValue={defaults?.explantType}
            placeholder={m.experiment_field_explant_type_placeholder()}
          />
        </Form.Field>
        <Form.Field name="baseMedium" label={m.experiment_field_base_medium()}>
          <Input
            disabled={disabled}
            defaultValue={defaults?.baseMedium}
            placeholder={m.experiment_field_base_medium_placeholder()}
          />
        </Form.Field>
        <DayField
          label={m.experiment_field_inoculated()}
          disabled={disabled}
          value={inoculatedOn}
          onChange={onInoculatedOnChange}
        />
      </Form.Group>
      <Form.Group title={m.experiment_group_analysis()}>
        <Form.Field
          layout="horizontal"
          label={m.experiment_field_counts_unclear()}
          desc={m.experiment_field_counts_unclear_description()}
        >
          <Switch
            size="small"
            checked={countsUnclear}
            disabled={disabled}
            onChange={onCountsUnclearChange}
          />
        </Form.Field>
      </Form.Group>
    </>
  );
}
