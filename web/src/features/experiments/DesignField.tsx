import { Plus, X } from "lucide-react";
import { Fragment } from "react";

import { replicateCodes } from "../../domain/experiments/naming";
import type { TreatmentDesignInput } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { Text } from "../../ui/kit/Text";
import { DEFAULT_REPLICATES, ReplicatesInput } from "./ReplicatesField";
import { TreatmentDot } from "./TreatmentDot";

/** A treatment being designed; `id` keeps its inputs with it when rows are removed. */
export type DesignRow = { id: number; name: string; replicates: number };

let nextRowId = 0;

function emptyRow(): DesignRow {
  nextRowId += 1;
  return { id: nextRowId, name: "", replicates: DEFAULT_REPLICATES };
}

export function initialDesign(): DesignRow[] {
  return [emptyRow()];
}

const MAX_TREATMENTS = 50;

export function submittedDesign(rows: DesignRow[]): TreatmentDesignInput[] {
  return rows
    .map(({ name, replicates }) => ({ name: name.trim(), replicates }))
    .filter((row) => row.name !== "");
}

/**
 * The design of an experiment: one row per treatment with the number of
 * replicates it is laid out in. The column headings and the rows share one
 * grid, so they line up.
 */
export function DesignField({
  disabled,
  rows,
  onChange,
}: {
  disabled: boolean;
  rows: DesignRow[];
  onChange: (rows: DesignRow[]) => void;
}) {
  const example =
    submittedDesign(rows)[0]?.name ?? m.treatment_name_placeholder();
  const update = (index: number, row: Partial<DesignRow>) =>
    onChange(
      rows.map((item, at) => (at === index ? { ...item, ...row } : item)),
    );
  return (
    <Form.Group
      title={m.experiment_design_label()}
      description={m.experiment_design_hint({
        example: replicateCodes(example, 1, [])[0]!,
      })}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
          <Text aria-hidden size="xs" type="secondary" className="col-start-2">
            {m.treatment_name_label()}
          </Text>
          <Text aria-hidden size="xs" type="secondary" className="col-span-2">
            {m.treatment_replicates_label()}
          </Text>
          {rows.map((row, index) => {
            const removeLabel = m.experiment_design_remove_treatment({
              name: row.name || String(index + 1),
            });
            return (
              <Fragment key={row.id}>
                <TreatmentDot position={index + 1} />
                <Input
                  aria-label={m.treatment_name_label()}
                  disabled={disabled}
                  placeholder={m.treatment_name_placeholder()}
                  value={row.name}
                  onValueChange={(name) => update(index, { name })}
                />
                <ReplicatesInput
                  className="w-28"
                  disabled={disabled}
                  value={row.replicates}
                  onChange={(replicates) => update(index, { replicates })}
                />
                <ActionIcon
                  title={removeLabel}
                  icon={X}
                  size="middle"
                  disabled={disabled || rows.length === 1}
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
                />
              </Fragment>
            );
          })}
        </div>
        <Button
          type="dashed"
          block
          icon={Plus}
          disabled={disabled || rows.length >= MAX_TREATMENTS}
          onClick={() => onChange([...rows, emptyRow()])}
        >
          {m.experiment_design_add_treatment()}
        </Button>
      </div>
    </Form.Group>
  );
}
