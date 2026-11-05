import { useState } from "react";

import type { ManualEntryRow } from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  ManualReading,
  ObservationRef,
  Treatment,
} from "../../domain/experiments/schema";
import {
  getManualEntry,
  updateManualReadings,
} from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { FormDialog } from "../../ui/FormDialog";
import { found } from "../../ui/found";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import { Select } from "../../ui/kit/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { formatList } from "../../ui/lists";
import { classLabel } from "../../ui/model-names";
import { formatCount } from "../../ui/numbers";
import { observationLabel } from "./labels";
import {
  type ManualReadingDraft,
  manualReadingDraft,
  manualReadingEntries,
} from "./manual-readings";
import { TreatmentName } from "./TreatmentName";

const FORM_ID = "enter-manual-readings";

/** One treatment's units on the day, as counts are entered for them. */
export interface ManualEntry {
  treatment: string;
  rows: ManualEntryRow[];
}

/** Reads one treatment's units on the day, to enter their counts. */
export async function readManualEntry(
  ref: ObservationRef,
  treatment: string,
): Promise<ManualEntry> {
  const rows = await getManualEntry({ data: { ...ref, treatment } });
  return { treatment, rows: found(rows) };
}

/**
 * Enters the counts of the units on one observation day by hand, one
 * treatment's units at a time, a row per unit and a field per class the day
 * counts: for a day that was not photographed, or whose dishes were counted
 * at the bench. Beside the fields stands what the day's photograph reads,
 * where there is one, so a count entered over it is entered knowingly. What
 * is typed for one treatment stays while another is shown, and saving
 * records every treatment's. A unit's row left empty keeps no count.
 */
export function EnterManualReadingsDialog({
  experiment,
  observation,
  treatments,
  entry,
  open,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  treatments: readonly Treatment[];
  /** The treatment the dialog opens on, read. */
  entry: ManualEntry;
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
      width="wide"
    >
      <ManualReadingsForm
        experiment={experiment}
        observation={observation}
        treatments={treatments}
        entry={entry}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function ManualReadingsForm({
  experiment,
  observation,
  treatments,
  entry,
  action,
  onDone,
}: {
  experiment: string;
  observation: ExperimentObservation;
  treatments: readonly Treatment[];
  entry: ManualEntry;
  action: AsyncAction;
  onDone: () => void;
}) {
  const classes = observation.countedClasses;
  const loading = useAsyncAction();
  const [shown, setShown] = useState(entry.treatment);
  // Every treatment read so far, and what was typed for its units.
  const [read, setRead] = useState<ReadonlyMap<string, ManualEntryRow[]>>(
    () => new Map([[entry.treatment, entry.rows]]),
  );
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ManualReadingDraft>>(
    () => draftsOf(classes, entry.rows),
  );
  const [incomplete, setIncomplete] = useState<readonly string[]>([]);
  const rows = read.get(shown) ?? [];
  const everyRow = [...read.values()].flat();
  const existing = new Map(
    everyRow.flatMap((row): [string, ManualReading][] =>
      row.manual ? [[row.unit.id, row.manual]] : [],
    ),
  );
  const codeOf = new Map(everyRow.map((row) => [row.unit.id, row.unit.code]));
  const show = (treatment: string) => {
    if (read.has(treatment)) {
      setShown(treatment);
      return;
    }
    void loading.run(
      () =>
        readManualEntry({ experiment, observation: observation.id }, treatment),
      m.experiment_units_not_loaded(),
      {
        invalidate: false,
        onSuccess: ({ rows }) => {
          setRead((previous) => new Map(previous).set(treatment, rows));
          setDrafts(
            (previous) => new Map([...draftsOf(classes, rows), ...previous]),
          );
          setShown(treatment);
        },
      },
    );
  };
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
            updateManualReadings({
              data: {
                experiment,
                observation: observation.id,
                readings: checked.entries,
              },
            }),
          m.manual_readings_not_saved(),
          {
            onSuccess: onDone,
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
            units: formatList(
              incomplete.map((unit) => codeOf.get(unit) ?? unit),
            ),
          })}
        />
      ) : null}
      <Table
        aria-label={m.manual_readings_label()}
        size="small"
        toolbar={
          treatments.length > 1 ? (
            <Select
              aria-label={m.treatment_label()}
              className="w-48"
              size="small"
              disabled={action.busy || loading.busy}
              options={treatments.map((item) => ({
                value: item.id,
                label: <TreatmentName treatment={item} />,
              }))}
              value={shown}
              onChange={show}
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableHead className="min-w-24">
              {m.experiment_column_unit()}
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
          {rows.map(({ unit, photographed }) => {
            const draft = drafts.get(unit.id) ?? {};
            return (
              <TableRow key={unit.id}>
                <TableCell cellSlot="title">{unit.code}</TableCell>
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
                    {photographed ? (
                      formatCount(photographed.count)
                    ) : (
                      <Absent />
                    )}
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

/** The drafts of the units read, as the form opens on them: their counts already entered. */
function draftsOf(
  classes: readonly string[],
  rows: readonly ManualEntryRow[],
): Map<string, ManualReadingDraft> {
  return new Map(
    rows.map((row) => [row.unit.id, manualReadingDraft(classes, row.manual)]),
  );
}
