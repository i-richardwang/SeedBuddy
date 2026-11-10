import {
  Divide,
  FolderPlus,
  ImageMinus,
  ImageUp,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { NamedDataset } from "../../domain/datasets/schema";
import type {
  BaselineDay,
  ExperimentObservationImageDetail,
  Unit,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import {
  removeObservationImage,
  removeUnit,
} from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { toast } from "../../ui/kit/Toast";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { ReplaceObservationImageDialog } from "./ReplaceObservationImageDialog";
import { UnitBaselineDialog } from "./UnitBaselineDialog";
import { UnitDialog } from "./UnitDialog";
import { unitTableSearch } from "./unit-table";

type Action = "replace" | "edit" | "baseline" | "dataset";

/** The unit's own commands and those on the photograph in view. */
export function UnitMenu({
  experiment,
  unit,
  treatments,
  observations,
  baselineDays,
  canRemove,
  image,
  datasets,
  table,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  /** The experiment's observations in its order. */
  observations: ExperimentObservation[];
  /** What the unit would take its rates over, were it to name an observation. */
  baselineDays: ReadonlyMap<string, BaselineDay>;
  canRemove: boolean;
  image: ExperimentObservationImageDetail | null;
  /** The datasets the photograph could join. */
  datasets: NamedDataset[];
  /** The page of the experiment's units table that holds the unit, where deleting it leads. */
  table: UnitPageRequest;
}) {
  const confirmDestructive = useConfirmDestructive();
  const navigateAfterWrite = useNavigateAfterWrite();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  const items: DropdownItem[] = [];
  if (image) {
    items.push({
      key: "replace",
      icon: ImageUp,
      label: m.unit_menu_replace(),
      onClick: () => setOpen("replace"),
    });
    items.push({
      key: "dataset",
      icon: FolderPlus,
      label: m.dataset_add_menu(),
      onClick: () => setOpen("dataset"),
    });
  }
  items.push({
    key: "edit",
    icon: Pencil,
    label: m.unit_menu_edit(),
    onClick: () => setOpen("edit"),
  });
  // A baseline other than the first observation takes a second one.
  if (observations.length > 1) {
    items.push({
      key: "baseline",
      icon: Divide,
      label: m.unit_baseline_menu(),
      onClick: () => setOpen("baseline"),
    });
  }
  if (image || canRemove) items.push({ type: "divider" });
  if (image) {
    items.push({
      key: "unassign",
      icon: ImageMinus,
      danger: true,
      label: m.unit_menu_unmatch(),
      onClick: () =>
        confirmDestructive({
          title: m.unit_unmatch_title({
            file: image.review.filename,
            code: unit.code,
          }),
          content: m.unit_unmatch_note(),
          confirmLabel: m.unit_unmatch(),
          failure: m.unit_photo_not_unmatched(),
          onConfirm: async () => {
            await removeObservationImage({ data: image.ref });
          },
          onSuccess: () => toast.success(m.unit_photo_unmatched()),
        }),
    });
  }
  if (canRemove) {
    items.push({
      key: "delete",
      icon: Trash2,
      danger: true,
      label: m.unit_menu_delete(),
      onClick: () =>
        confirmDestructive({
          title: m.item_delete_title({ name: unit.code }),
          confirmLabel: m.unit_delete(),
          failure: m.unit_not_deleted(),
          onConfirm: async () => {
            await removeUnit({ data: { experiment, unit: unit.id } });
          },
          onSuccess: async () => {
            toast.success(m.item_deleted({ name: unit.code }));
            await navigateAfterWrite({
              to: "/experiments/$experiment",
              params: { experiment },
              search: unitTableSearch(table),
            });
          },
          invalidate: false,
        }),
    });
  }

  return (
    <>
      <PageMenu label={m.item_actions({ name: unit.code })} items={items} />

      <UnitDialog
        experiment={experiment}
        unit={unit}
        treatments={treatments}
        open={open === "edit"}
        onClose={close}
      />

      {observations.length > 1 ? (
        <UnitBaselineDialog
          experiment={experiment}
          choice={{ units: [unit] }}
          observations={observations}
          days={baselineDays}
          open={open === "baseline"}
          onClose={close}
          onDone={close}
        />
      ) : null}

      {image ? (
        <>
          <ReplaceObservationImageDialog
            image={image}
            open={open === "replace"}
            onClose={close}
          />
          <AddToDatasetDialog
            open={open === "dataset"}
            images={[image.ref]}
            datasets={datasets}
            onClose={close}
          />
        </>
      ) : null}
    </>
  );
}
