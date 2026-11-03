import { useState } from "react";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import { imageReading } from "../../domain/experiments/readings";
import type {
  ExperimentObservation,
  ManualReading,
  Treatment,
} from "../../domain/experiments/schema";
import { enterManualReadings } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { classLabel } from "../../ui/model-names";
import { formatCount } from "../../ui/numbers";
import { observationLabel } from "./labels";
import {
  type ManualReadingDraft,
  manualReadingDraft,
  manualReadingEntries,
} from "./manual-readings";
import { TreatmentName } from "./TreatmentsTable";

const FORM_ID = "enter-manual-readings";

/**
 * Enters the counts of the units on one observation day by hand, a row per
 * unit and a field per class the day counts: for a day that was not
 * photographed, or whose dishes were counted at the bench. Beside the fields
 * stands what the day's photograph reads, where there is one, so a count
 * entered over it is entered knowingly. A unit's row left empty keeps no
 * count.
 */
export function EnterManualReadingsDialog({
  experiment,
  observation,
  units,
  treatments,
  images,
  manualReadings,
  open,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  /** The units that can be counted at this observation, in the grid's order. */
  units: readonly Unit[];
  treatments: readonly Treatment[];
  /** The photographs taken at this observation. */
  images: readonly ObservationImageCell[];
  /** The counts already entered for this observation. */
  manualReadings: readonly ManualReading[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.manual_readings_title({
        observation: observationLabel(observation),
      })}
      okText={m.manual_readings_save()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={units.length === 0}
      width="wide"
    >
      <ManualReadingsForm
        experiment={experiment}
        observation={observation}
        units={units}
        treatments={treatments}
        images={images}
        manualReadings={manualReadings}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function ManualReadingsForm({
  experiment,
  observation,
  units,
  treatments,
  images,
  manualReadings,
  action,
  onDone,
}: {
  experiment: string;
  observation: ExperimentObservation;
  units: readonly Unit[];
  treatments: readonly Treatment[];
  images: readonly ObservationImageCell[];
  manualReadings: readonly ManualReading[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const classes = observation.countedClasses;
  const existing = new Map(manualReadings.map((item) => [item.unit, item]));
  const photographs = new Map(images.map((image) => [image.unit, image]));
  const treatmentOf = new Map(treatments.map((item) => [item.id, item]));
  const codeOf = new Map(units.map((unit) => [unit.id, unit.code]));
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ManualReadingDraft>>(
    () =>
      new Map(
        units.map((unit) => [
          unit.id,
          manualReadingDraft(classes, existing.get(unit.id)),
        ]),
      ),
  );
  const [incomplete, setIncomplete] = useState<readonly string[]>([]);
  const setValue = (unit: string, name: string, value: number | null) => {
    setDrafts((previous) => {
      const next = new Map(previous);
      next.set(unit, { ...previous.get(unit), [name]: value });
      return next;
    });
    setIncomplete((previous) => previous.filter((item) => item !== unit));
  };

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const checked = manualReadingEntries(classes, drafts, existing);
        setIncomplete(checked.incomplete);
        if (checked.incomplete.length > 0) return;
        if (checked.entries.length === 0) {
          onDone();
          return;
        }
        void action.run(
          () =>
            enterManualReadings({
              data: {
                experiment,
                observation: observation.id,
                readings: checked.entries,
              },
            }),
          m.manual_readings_not_saved(),
          {
            onSuccess: () => {
              onDone();
              toast.success(
                m.manual_readings_saved({ count: checked.entries.length }),
              );
            },
          },
        );
      }}
    >
      <Text as="p" size="sm" type="secondary">
        {m.manual_readings_description()}
      </Text>
      {incomplete.length > 0 ? (
        <Alert
          type="error"
          title={m.manual_readings_incomplete({
            units: incomplete
              .map((unit) => codeOf.get(unit) ?? unit)
              .join(", "),
          })}
        />
      ) : null}
      <Table aria-label={m.manual_readings_save()} size="small">
        <TableHeader>
          <tr>
            <TableHead className="min-w-24">
              {m.experiment_column_unit()}
            </TableHead>
            <TableHead className="min-w-32">
              {m.experiment_column_treatment()}
            </TableHead>
            {classes.map((name) => (
              <TableHead key={name} className="min-w-28">
                {classLabel(name)}
              </TableHead>
            ))}
            <TableHead className="min-w-24" align="right">
              {m.manual_readings_column_photograph()}
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {units.map((unit) => {
            const draft = drafts.get(unit.id) ?? {};
            const owner = treatmentOf.get(unit.treatment);
            const photographed = imageReading(
              photographs.get(unit.id),
              observation,
            );
            return (
              <TableRow key={unit.id}>
                <TableCell cellSlot="title">{unit.code}</TableCell>
                <TableCell>
                  {owner ? <TreatmentName treatment={owner} /> : null}
                </TableCell>
                {classes.map((name) => (
                  <TableCell key={name}>
                    <InputNumber
                      aria-label={m.manual_readings_field({
                        unit: unit.code,
                        class: classLabel(name),
                      })}
                      className="w-24"
                      min={0}
                      step={1}
                      disabled={action.busy}
                      value={draft[name] ?? null}
                      onChange={(value) => setValue(unit.id, name, value)}
                    />
                  </TableCell>
                ))}
                <TableCell align="right">
                  <Text as="span" type="tertiary" className="tabular-nums">
                    {photographed ? formatCount(photographed.count) : null}
                  </Text>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Form>
  );
}
