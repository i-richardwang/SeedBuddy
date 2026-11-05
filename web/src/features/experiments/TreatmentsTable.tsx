import { Plus } from "lucide-react";
import { useState } from "react";

import type { TreatmentFrame } from "../../domain/experiments/read-model";
import { formatFactor } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { Button } from "../../ui/kit/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { formatCount } from "../../ui/numbers";
import { TreatmentDialog } from "./TreatmentDialog";
import { TreatmentMenu } from "./TreatmentMenu";
import { TreatmentName } from "./TreatmentName";

/**
 * The experiment's design: each treatment, what sets it apart, and how many
 * units it holds, with a new treatment added from the toolbar.
 */
export function TreatmentsTable({
  experiment,
  treatments,
}: {
  experiment: string;
  /** Each treatment with how many units it holds. */
  treatments: readonly TreatmentFrame[];
}) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Table
        aria-label={m.treatments_label()}
        narrow="cards"
        toolbar={
          <Button size="small" icon={Plus} onClick={() => setAdding(true)}>
            {m.treatment_new()}
          </Button>
        }
      >
        <TableHeader>
          <tr>
            <TableHead>{m.treatment_label()}</TableHead>
            <TableHead>{m.treatment_factor_label()}</TableHead>
            <TableHead>{m.note_label()}</TableHead>
            <TableHead className="w-24" numeric>
              {m.units_label()}
            </TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {treatments.map((treatment) => {
            const factor = formatFactor(treatment.factor);
            return (
              <TableRow key={treatment.id}>
                <TableCell cellSlot="title">
                  <TreatmentName treatment={treatment} />
                </TableCell>
                <TableCell cellLabel={m.treatment_factor_label()}>
                  {factor || <Absent />}
                </TableCell>
                <TableCell cellLabel={m.note_label()}>
                  {treatment.note ? (
                    <span className="line-clamp-2">{treatment.note}</span>
                  ) : (
                    <Absent />
                  )}
                </TableCell>
                <TableCell cellLabel={m.units_label()} numeric>
                  {formatCount(treatment.units)}
                </TableCell>
                <TableCell cellSlot="actions" className="text-end">
                  <TreatmentMenu
                    experiment={experiment}
                    treatment={treatment}
                    deletable={treatments.length > 1}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <TreatmentDialog
        experiment={experiment}
        treatment={null}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </>
  );
}
