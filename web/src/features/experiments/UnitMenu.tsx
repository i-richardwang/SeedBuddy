import { FolderPlus, ImageMinus, ImageUp, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { NamedDataset } from "../../domain/datasets/schema";
import type {
  ExperimentObservationImageDetail,
  Unit,
} from "../../domain/experiments/read-model";
import type { Treatment } from "../../domain/experiments/schema";
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
import { UnitDialog } from "./UnitDialog";

type Action = "replace" | "edit" | "dataset";


/** The unit's own commands and those on the photograph in view. */
export function UnitMenu({
  experiment,
  unit,
  treatments,
  canRemove,
  image,
  datasets,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  canRemove: boolean;
  image: ExperimentObservationImageDetail | null;
  /** The datasets the photograph could join. */
  datasets: NamedDataset[];
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
  if (image || canRemove) items.push({ type: "divider" });
  if (image) {
    items.push({
      key: "unassign",
      icon: ImageMinus,
      danger: true,
      label: m.unit_menu_unassign(),
      onClick: () =>
        confirmDestructive({
          title: m.unit_unassign_title({
            file: image.review.filename,
            code: unit.code,
          }),
          content: m.unit_unassign_note(),
          confirmLabel: m.unit_unassign(),
          onConfirm: async () => {
            await removeObservationImage({ data: image.ref });
          },
          onSuccess: () => toast.success(m.unit_image_unassigned()),
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
          onConfirm: async () => {
            await removeUnit({ data: { experiment, unit: unit.id } });
          },
          onSuccess: async () => {
            toast.success(m.item_deleted({ name: unit.code }));
            await navigateAfterWrite({
              to: "/experiments/$experiment",
              params: { experiment },
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
