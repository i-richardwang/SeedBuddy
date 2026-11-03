import { ArrowRightLeft, ClipboardPen, X } from "lucide-react";
import { useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Text } from "../../ui/kit/Text";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "../../ui/kit/Toolbar";
import { MoveUnitsDialog } from "./MoveUnitsDialog";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";

/**
 * Commands for the selected units, shown while any unit is selected. With
 * nothing selected the bar keeps its place, invisible, so selecting shifts
 * nothing around it.
 */
export function UnitSelectionBar({
  experiment,
  units,
  treatments,
  observations,
  onClear,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  observations: ExperimentObservation[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState<"record" | "move" | null>(null);
  // A dialog about the selection closes when the selection empties.
  if (units.length === 0 && open !== null) setOpen(null);
  const close = () => setOpen(null);
  const hidden = units.length === 0;

  return (
    <>
      <Toolbar
        aria-label={m.experiment_selection()}
        className={hidden ? "invisible" : undefined}
      >
        <Text
          as="span"
          size="sm"
          weight="medium"
          className="px-3 whitespace-nowrap tabular-nums"
        >
          {m.experiment_selection_count({ count: units.length })}
        </Text>
        <ToolbarSeparator />
        <ToolbarButton
          disabled={observations.length === 0}
          render={
            <Button
              type="text"
              icon={ClipboardPen}
              aria-label={m.culture_event_record()}
              onClick={() => setOpen("record")}
            >
              <span className="max-mobile:hidden">
                {m.culture_event_record()}
              </span>
            </Button>
          }
        />
        <ToolbarButton
          disabled={treatments.length < 2}
          render={
            <Button
              type="text"
              icon={ArrowRightLeft}
              aria-label={m.experiment_move_units()}
              onClick={() => setOpen("move")}
            >
              <span className="max-mobile:hidden">
                {m.experiment_move_units()}
              </span>
            </Button>
          }
        />
        <ToolbarSeparator />
        <ToolbarButton
          render={
            <ActionIcon
              icon={X}
              title={m.experiment_selection_clear()}
              onClick={onClear}
            />
          }
        />
      </Toolbar>
      <RecordCultureEventDialog
        experiment={experiment}
        units={units}
        observations={observations}
        open={open === "record"}
        onClose={close}
      />
      <MoveUnitsDialog
        experiment={experiment}
        units={units}
        treatments={treatments}
        open={open === "move"}
        onClose={close}
      />
    </>
  );
}
