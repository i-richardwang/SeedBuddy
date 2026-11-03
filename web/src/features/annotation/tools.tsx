import { Hash, Redo2, ScanSearch, Square, Trash2, Undo2 } from "lucide-react";

import {
  classColor,
  classCount,
  type Tally,
} from "../../domain/models/classes";
import { m } from "../../paraglide/messages";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { ToolbarSeparator } from "../../ui/kit/Toolbar";
import { classLabel } from "../../ui/model-names";
import { classShortcut, type LayerKey } from "./controls";

/**
 * What a press on the image does next: the class a new box takes, or the
 * selected box's class, picked from the model's classes with how many boxes
 * hold each; then taking edits back and removing the selected box.
 */
export function EditTools({
  classes,
  tally,
  boxClass,
  onClassChange,
  history,
  onUndo,
  onRedo,
  canDelete,
  onDelete,
}: {
  classes: string[];
  tally: Tally;
  boxClass: string;
  onClassChange: (name: string) => void;
  history: { canUndo: boolean; canRedo: boolean };
  onUndo: () => void;
  onRedo: () => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <>
      {classes.length > 1 ? (
        <>
          <ToggleGroup
            aria-label={m.annotation_box_class()}
            value={boxClass}
            options={classes.map((name) => ({
              value: name,
              label: m.annotation_named_count({
                name: classLabel(name),
                count: classCount(tally, name),
              }),
              mark: <ColorSwatch color={classColor(classes, name).hex} />,
              hotkey: classShortcut(classes, name) ?? undefined,
            }))}
            onChange={onClassChange}
          />
          <ToolbarSeparator />
        </>
      ) : null}
      <ActionIcon
        icon={Undo2}
        size="small"
        title={m.annotation_undo()}
        tooltipProps={{ hotkey: "mod+z", placement: "bottom" }}
        disabled={!history.canUndo}
        onClick={onUndo}
      />
      <ActionIcon
        icon={Redo2}
        size="small"
        title={m.annotation_redo()}
        tooltipProps={{ hotkey: "shift+mod+z", placement: "bottom" }}
        disabled={!history.canRedo}
        onClick={onRedo}
      />
      <ActionIcon
        icon={Trash2}
        size="small"
        title={m.annotation_delete()}
        tooltipProps={{ hotkey: "backspace", placement: "bottom" }}
        disabled={!canDelete}
        onClick={onDelete}
      />
    </>
  );
}

const LAYER_ICONS = { boxes: Square, ids: Hash, checks: ScanSearch } as const;

const LAYER_LABELS = {
  boxes: m.annotation_layer_boxes,
  ids: m.annotation_layer_ids,
  checks: m.annotation_ai_checks,
} as const;

/** What is drawn over the image, each shown or hidden by its own toggle. */
export function LayerControls({
  available,
  layers,
  onLayersChange,
}: {
  available: readonly LayerKey[];
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}) {
  return available.map((key) => {
    const on = layers.has(key);
    return (
      <ActionIcon
        key={key}
        icon={LAYER_ICONS[key]}
        size="small"
        title={LAYER_LABELS[key]()}
        pressed={on}
        onClick={() => {
          const next = new Set(layers);
          if (on) next.delete(key);
          else next.add(key);
          onLayersChange(next);
        }}
      />
    );
  });
}
