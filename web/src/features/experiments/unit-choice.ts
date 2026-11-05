import type { Unit } from "../../domain/experiments/read-model";
import type { UnitSelection } from "../../domain/experiments/schema";

/**
 * The units a command is about: those ticked, or every unit of the
 * treatment the table is narrowed to, or of the experiment, `count` of them.
 */
export type UnitChoice =
  { units: Unit[] } | { treatment: string | null; count: number };

/** How many units a choice holds. */
export function choiceSize(choice: UnitChoice): number {
  return "units" in choice ? choice.units.length : choice.count;
}

/**
 * The units a choice holds, as a command names them: a choice by treatment
 * states how many units it was made over, so the command is refused should
 * the experiment have changed since.
 */
export function choiceSelection(choice: UnitChoice): UnitSelection {
  return "units" in choice
    ? choice.units.map((unit) => unit.id)
    : { treatment: choice.treatment, expected: choice.count };
}
