import { FolderPlus, Images, Pencil, PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";

import type { NamedDataset } from "../../domain/datasets/schema";
import type {
  ObservationFrame,
  PhotoSlots,
} from "../../domain/experiments/read-model";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { getModelDatasets } from "../../functions/datasets";
import { getPhotoSlots, removeObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { found } from "../../ui/found";
import type { ShownDialog } from "../../ui/hooks/useDialog";
import { useLoadedDialog } from "../../ui/hooks/useLoadedDialog";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { TableHeadMenu } from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { AddPhotosDialog } from "./AddPhotosDialog";
import { observationQuestion } from "./copy";
import {
  EnterManualReadingsDialog,
  type ManualEntry,
  readManualEntry,
} from "./EnterManualReadingsDialog";
import { observationLabel } from "./labels";
import { ObservationDialog } from "./ObservationDialog";

/** What each action on the day reads when it opens, and no more. */
type DayReads = {
  images: PhotoSlots;
  readings: ManualEntry;
  dataset: NamedDataset[];
};

/**
 * An observation day's column heading, opening what can be done to that day.
 * The day heads the column; what it asks, when that needs saying, sits on a
 * line under it. Each action reads what it needs of the day when it opens,
 * not with the table.
 */
export function ObservationMenu({
  experiment,
  inoculatedOn,
  observation,
  observations,
  treatments,
  treatment,
  models,
}: {
  experiment: string;
  inoculatedOn: string;
  observation: ObservationFrame;
  /** Every observation of the experiment, whose days this one cannot move to. */
  observations: readonly ExperimentObservation[];
  treatments: readonly Treatment[];
  /** The treatment the page is narrowed to, which counts are entered for first. */
  treatment: string | null;
  models: readonly Model[];
}) {
  const confirmDestructive = useConfirmDestructive();
  const [editing, setEditing] = useState(false);
  const day = useLoadedDialog<DayReads>();
  const ref = { experiment, observation: observation.id };
  const name = observationLabel(observation);
  const question = observationQuestion(
    observation,
    models.find((model) => model.id === observation.modelId),
    { nameModel: new Set(observations.map((item) => item.modelId)).size > 1 },
  );
  const addPhotos = () =>
    day.show(
      "images",
      async () => found(await getPhotoSlots({ data: ref })),
      m.observation_not_loaded(),
    );
  // Counts are entered only on a day with units on the bench, so the
  // experiment has a treatment to begin with.
  const enterCounts = () =>
    day.show(
      "readings",
      () => readManualEntry(ref, treatment ?? treatments[0]!.id),
      m.observation_not_loaded(),
    );
  const addToDataset = () =>
    day.show(
      "dataset",
      () => getModelDatasets({ data: { model: observation.modelId } }),
      m.observation_not_loaded(),
    );

  const items: DropdownItem[] = [];
  if (observation.vacant > 0) {
    items.push({
      key: "images",
      icon: Images,
      label: m.observation_menu_add_photos(),
      onClick: addPhotos,
    });
  }
  if (observation.available > 0) {
    items.push({
      key: "readings",
      icon: PencilLine,
      label: m.observation_menu_manual_readings(),
      onClick: enterCounts,
    });
  }
  if (observation.photographed > 0) {
    items.push({
      key: "dataset",
      icon: FolderPlus,
      label: m.observation_menu_add_to_dataset(),
      onClick: addToDataset,
    });
  }
  items.push({
    key: "edit",
    icon: Pencil,
    label: m.observation_menu_edit(),
    onClick: () => setEditing(true),
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
            title: m.item_delete_title({ name }),
            confirmLabel: m.observation_delete(),
            failure: m.observation_not_deleted(),
            onConfirm: async () => {
              await removeObservation({
                data: { experiment, observation: observation.id },
              });
            },
            onSuccess: () => {
              toast.success(m.item_deleted({ name }));
            },
          }),
      },
    );
  }

  return (
    <>
      <TableHeadMenu
        aria-label={m.item_actions({
          name: question
            ? m.observation_heading({ day: name, question })
            : name,
        })}
        items={items}
        busy={day.loading}
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

      {day.last ? (
        <ObservationDayDialog
          experiment={experiment}
          observation={observation}
          treatments={treatments}
          dialog={day.last}
          open={day.open}
          onClose={day.close}
        />
      ) : null}

      <ObservationDialog
        experiment={experiment}
        inoculatedOn={inoculatedOn}
        models={models}
        observation={observation}
        observations={observations}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

/** The dialog of the action last opened on the day, given what it read. */
function ObservationDayDialog({
  experiment,
  observation,
  treatments,
  dialog,
  open,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  treatments: readonly Treatment[];
  dialog: ShownDialog<DayReads>;
  open: boolean;
  onClose: () => void;
}) {
  switch (dialog.key) {
    case "images":
      return (
        <AddPhotosDialog
          experiment={experiment}
          observation={observation}
          slots={dialog.value}
          open={open}
          onClose={onClose}
        />
      );
    case "readings":
      return (
        <EnterManualReadingsDialog
          experiment={experiment}
          observation={observation}
          treatments={treatments}
          entry={dialog.value}
          open={open}
          onClose={onClose}
        />
      );
    case "dataset":
      return (
        <AddToDatasetDialog
          open={open}
          images={{ experiment, observation: observation.id }}
          datasets={dialog.value}
          heading={m.observation_add_to_dataset()}
          onClose={onClose}
        />
      );
  }
}
