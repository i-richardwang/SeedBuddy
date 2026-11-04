import { classColor } from "../../domain/models/classes";
import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { classLabel } from "../../ui/model-names";

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
