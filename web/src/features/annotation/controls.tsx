import { classColor } from "../../domain/models/classes";
import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { classLabel } from "../../ui/model-names";

/** Theme colors of the canvas drawing; boxes take their class's color. */
export const CANVAS_COLORS = {
  selected: "var(--color-info)",
  handle: "var(--color-container)",
  check: "var(--color-warning)",
} as const;

/** A class by its name, beside the color its boxes are drawn in. */
export function ClassLabel({
  classes,
  name,
}: {
  classes: readonly string[];
  name: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ColorSwatch color={classColor(classes, name).hex} />
      <span className="truncate">{classLabel(name)}</span>
    </span>
  );
}

/** A model's classes answer to the digit keys, in the order it declares them. */
export function classShortcut(
  classes: readonly string[],
  name: string,
): string | null {
  const index = classes.indexOf(name);
  return classes.length > 1 && index < 9 ? String(index + 1) : null;
}

export function classForShortcut(
  classes: readonly string[],
  key: string,
): string | null {
  return classes.find((name) => classShortcut(classes, name) === key) ?? null;
}

/** The class after this one in the model's order, wrapping around: a pressed box's next state. */
export function nextClass(classes: readonly string[], name: string): string {
  return classes[(classes.indexOf(name) + 1) % classes.length]!;
}

/** What can be drawn over the image: the boxes, their numbers, and the boxes to confirm. */
export type LayerKey = "boxes" | "ids" | "checks";
