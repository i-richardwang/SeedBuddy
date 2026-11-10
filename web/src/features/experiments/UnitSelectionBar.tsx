import { ArrowRightLeft, ClipboardPen, Divide, X } from "lucide-react";

import type { Unit } from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { useDialog } from "../../ui/hooks/useDialog";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Text } from "../../ui/kit/Text";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "../../ui/kit/Toolbar";
import { MoveUnitsDialog } from "./MoveUnitsDialog";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";
import { UnitBaselineDialog } from "./UnitBaselineDialog";
import { choiceSize, type UnitChoice } from "./unit-choice";

/**
 * Commands for the selected units, shown while any unit is selected. With
 * nothing selected the bar keeps its place, invisible, so selecting shifts
 * nothing around it.
 */
export function UnitSelectionBar({
  experiment,
  choice,
  treatments,
  observations,
  onClear,
}: {
  experiment: string;
  choice: UnitChoice;
  treatments: Treatment[];
  observations: ExperimentObservation[];
  onClear: () => void;
}) {
  // A dialog acts on the units chosen when it opened, whatever a refresh
  // does to the selection meanwhile.
  const dialog = useDialog<{
    record: UnitChoice;
    baseline: UnitChoice;
    move: Unit[];
  }>();
  const size = choiceSize(choice);
  const done = () => {
    dialog.close();
    onClear();
  };
  const hidden = size === 0;

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
          {m.experiment_selection_count({ count: size })}
        </Text>
        <ToolbarSeparator />
        <ToolbarButton
          disabled={observations.length === 0}
          render={
            <Button
              type="text"
              icon={ClipboardPen}
              aria-label={m.culture_event_record()}
              onClick={() => dialog.show("record", choice)}
            >
              <span className="max-mobile:hidden">
                {m.culture_event_record()}
              </span>
            </Button>
          }
        />
        <ToolbarButton
          // A baseline other than the first observation takes a second one.
          disabled={observations.length < 2}
          render={
            <Button
              type="text"
              icon={Divide}
              aria-label={m.unit_baseline()}
              onClick={() => dialog.show("baseline", choice)}
            >
              <span className="max-mobile:hidden">{m.unit_baseline()}</span>
            </Button>
          }
        />
        <ToolbarButton
          // Units move one by one; a whole treatment is not moved.
          disabled={treatments.length < 2 || !("units" in choice)}
          render={
            <Button
              type="text"
              icon={ArrowRightLeft}
              aria-label={m.experiment_move_units()}
              onClick={() => {
                if ("units" in choice) dialog.show("move", choice.units);
              }}
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
      {dialog.last?.key === "record" ? (
        <RecordCultureEventDialog
          experiment={experiment}
          choice={dialog.last.value}
          observations={observations}
          open={dialog.open}
          onClose={dialog.close}
          onDone={done}
        />
      ) : null}
      {dialog.last?.key === "baseline" ? (
        <UnitBaselineDialog
          experiment={experiment}
          choice={dialog.last.value}
          observations={observations}
          open={dialog.open}
          onClose={dialog.close}
          onDone={done}
        />
      ) : null}
      {dialog.last?.key === "move" ? (
        <MoveUnitsDialog
          experiment={experiment}
          units={dialog.last.value}
          treatments={treatments}
          open={dialog.open}
          onClose={dialog.close}
          onDone={done}
        />
      ) : null}
    </>
  );
}
