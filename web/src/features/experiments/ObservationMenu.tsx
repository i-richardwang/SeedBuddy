import { FolderPlus, Images, Pencil, PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";

import type { NamedDataset } from "../../domain/datasets/schema";
import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import type { PlacedPhoto } from "../../domain/experiments/photos";
import type {
  ExperimentObservation,
  ManualReading,
  Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { removeObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { TableHeadMenu } from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { AddPhotosDialog } from "./AddPhotosDialog";
import { observationLabel } from "./labels";
import { EnterManualReadingsDialog } from "./ManualReadingsDialog";
import { EditObservationDialog } from "./ObservationDialog";

type Action = "images" | "readings" | "dataset" | "edit";

/**
 * An observation day's column heading, opening what can be done to that day.
 * The day heads the column; what it asks, when that needs saying, sits on a
 * line under it.
 */
export function ObservationMenu({
  experiment,
  inoculatedOn,
  observation,
  observations,
  question,
  units,
  images,
  manualReadings,
  treatments,
  placed,
  models,
  datasets,
}: {
  experiment: string;
  inoculatedOn: string;
  observation: ExperimentObservation;
  /** Every observation of the experiment, whose days this one cannot move to. */
  observations: readonly ExperimentObservation[];
  /** What the day asks of its photographs, or empty when nothing needs saying. */
  question: string;
  /** The units that can still be photographed at this observation. */
  units: Unit[];
  /** The images taken at this observation. */
  images: ObservationImageCell[];
  /** The counts entered by hand at this observation. */
  manualReadings: ManualReading[];
  treatments: readonly Treatment[];
  /** The photographs the experiment holds across all its observations. */
  placed: readonly PlacedPhoto[];
  models: readonly Model[];
  /** The datasets training the observation's model. */
  datasets: NamedDataset[];
}) {
  const confirmDestructive = useConfirmDestructive();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);
  const name = observationLabel(observation);
  const assigned = new Set(images.map((image) => image.unit));
  const vacant = units.filter((unit) => !assigned.has(unit.id));

  const items: DropdownItem[] = [];
  if (vacant.length > 0) {
    items.push({
      key: "images",
      icon: Images,
      label: m.observation_menu_add_photos(),
      onClick: () => setOpen("images"),
    });
  }
  if (units.length > 0) {
    items.push({
      key: "readings",
      icon: PencilLine,
      label: m.observation_menu_manual_readings(),
      onClick: () => setOpen("readings"),
    });
  }
  if (images.length > 0) {
    items.push({
      key: "dataset",
      icon: FolderPlus,
      label: m.observation_menu_add_to_dataset(),
      onClick: () => setOpen("dataset"),
    });
  }
  items.push({
    key: "edit",
    icon: Pencil,
    label: m.observation_menu_edit(),
    onClick: () => setOpen("edit"),
  });
  if (!observation.hasRecords) {
    items.push(
      { type: "divider" },
      {
        key: "delete",
        icon: Trash2,
        danger: true,
        label: m.observation_menu_delete(),
        onClick: () =>
          confirmDestructive({
            title: m.observation_delete_title({ observation: name }),
            confirmLabel: m.observation_delete(),
            onConfirm: async () => {
              await removeObservation({
                data: { experiment, observation: observation.id },
              });
            },
            onSuccess: () => {
              toast.success(m.observation_deleted({ observation: name }));
            },
          }),
      },
    );
  }

  return (
    <>
      <TableHeadMenu
        aria-label={m.observation_actions({
          observation: question
            ? m.observation_heading({ day: name, question })
            : name,
        })}
        items={items}
      >
        <span className="flex flex-col items-start">
          {name}
          {question ? (
            <Text as="span" size="xs" type="quaternary" weight="regular">
              {question}
            </Text>
          ) : null}
        </span>
      </TableHeadMenu>

      <AddPhotosDialog
        experiment={experiment}
        observation={observation}
        units={units}
        assigned={assigned}
        placed={placed}
        open={open === "images"}
        onClose={close}
      />

      <EnterManualReadingsDialog
        experiment={experiment}
        observation={observation}
        units={units}
        treatments={treatments}
        images={images}
        manualReadings={manualReadings}
        open={open === "readings"}
        onClose={close}
      />

      <AddToDatasetDialog
        open={open === "dataset"}
        images={images.map((image) => ({
          experiment,
          observationImage: image.id,
        }))}
        datasets={datasets}
        heading={m.observation_add_to_dataset()}
        onClose={close}
      />

      <EditObservationDialog
        experiment={experiment}
        inoculatedOn={inoculatedOn}
        models={models}
        observation={observation}
        observations={observations}
        open={open === "edit"}
        onClose={close}
      />
    </>
  );
}
