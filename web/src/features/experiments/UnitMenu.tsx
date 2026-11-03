import { useRouter } from "@tanstack/react-router";
import {
  ChevronDown,
  CircleMinus,
  ClipboardPen,
  Eye,
  EyeOff,
  FolderPlus,
  ImageMinus,
  ImageUp,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { NamedDataset } from "../../domain/datasets/schema";
import type {
  ExperimentObservationImage,
  Unit,
} from "../../domain/experiments/contracts";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import {
  removeCultureEvent,
  removeObservationImage,
  removeUnit,
} from "../../functions/experiments";
import { clearUnclear, markUnclear } from "../../functions/images";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  runAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { Button } from "../../ui/kit/Button";
import { type DropdownItem, DropdownMenu } from "../../ui/kit/DropdownMenu";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { cultureEventLabel, observationLabel } from "./labels";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";
import { ReplaceObservationImageDialog } from "./ReplaceObservationImageDialog";
import { UnitDialog } from "./UnitDialog";

type Action = "replace" | "edit" | "dataset";

const REMOVE_EVENT_FORM = "remove-culture-event";

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
  image: ExperimentObservationImage | null;
  /** The datasets the photograph could join. */
  datasets: NamedDataset[];
}) {
  const router = useRouter();
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
  }
  if (image) {
    items.push({
      key: "dataset",
      icon: FolderPlus,
      label: m.dataset_add_menu(),
      onClick: () => setOpen("dataset"),
    });
    // Marks the photograph unclear or clears its mark; either only changes
    // what counts.
    const { unclear } = image;
    const file = image.review.filename;
    const ref = { digest: image.review.ref.digest };
    items.push({
      key: "unclear",
      icon: unclear ? Eye : EyeOff,
      label: unclear ? m.unclear_menu_clear() : m.unclear_menu_mark(),
      onClick: async () => {
        const result = await runAction(async () => {
          if (unclear) await clearUnclear({ data: ref });
          else await markUnclear({ data: ref });
        }, m.unclear_not_saved());
        if (!result.ok) return;
        toast.success(
          unclear ? m.unclear_cleared({ file }) : m.unclear_marked({ file }),
        );
        await router.invalidate();
      },
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
            toast.success(m.unit_image_unassigned());
            await navigateAfterWrite({
              to: "/experiments/$experiment",
              params: { experiment: image.ref.experiment },
            });
          },
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
          title: m.unit_delete_title({ code: unit.code }),
          confirmLabel: m.unit_delete(),
          onConfirm: async () => {
            await removeUnit({ data: { experiment, unit: unit.id } });
          },
          onSuccess: () => {
            toast.success(m.unit_deleted({ code: unit.code }));
          },
          invalidate: () => router.invalidate(),
        }),
    });
  }

  return (
    <>
      <PageMenu label={m.unit_actions({ code: unit.code })} items={items} />

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

/**
 * The unit's culture status, as a menu of what changes it: recording an
 * event, or taking one back.
 */
export function CultureMenu({
  experiment,
  unit,
  observations,
  status,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  /** The status as it reads now. */
  status: string;
}) {
  const [open, setOpen] = useState<"record" | "remove" | null>(null);
  const close = () => setOpen(null);
  const items: DropdownItem[] = [];
  if (observations.length > 0) {
    items.push({
      key: "record",
      icon: ClipboardPen,
      label: m.culture_event_menu_record(),
      onClick: () => setOpen("record"),
    });
  }
  if (unit.events.length > 0) {
    items.push({
      key: "remove",
      icon: CircleMinus,
      label: m.culture_event_menu_remove(),
      onClick: () => setOpen("remove"),
    });
  }
  if (items.length === 0)
    return (
      <Text as="span" size="sm">
        {status}
      </Text>
    );
  return (
    <>
      <DropdownMenu items={items} align="end">
        <Button size="small" type="text" icon={ChevronDown} iconPosition="end">
          {status}
        </Button>
      </DropdownMenu>
      <RecordCultureEventDialog
        experiment={experiment}
        units={[unit]}
        observations={observations}
        open={open === "record"}
        onClose={close}
      />
      <RemoveCultureEventDialog
        experiment={experiment}
        unit={unit}
        observations={observations}
        open={open === "remove"}
        onClose={close}
      />
    </>
  );
}

function RemoveCultureEventDialog({
  experiment,
  unit,
  observations,
  open,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.culture_event_remove()}
      okText={m.culture_event_remove_action()}
      formId={REMOVE_EVENT_FORM}
      busy={action.busy}
      danger
    >
      <RemoveCultureEventForm
        experiment={experiment}
        unit={unit}
        observations={observations}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

/** Proposes the unit's latest status. */
function RemoveCultureEventForm({
  experiment,
  unit,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const { events } = unit;
  const [event, setEvent] = useState(events.at(-1)?.id ?? "");
  const describe = (item: (typeof events)[number]) => {
    const observation = observations.find(
      (entry) => entry.id === item.observation,
    );
    return observation
      ? m.culture_event_at({
          event: cultureEventLabel(item.type),
          observation: observationLabel(observation),
        })
      : cultureEventLabel(item.type);
  };

  return (
    <Form
      id={REMOVE_EVENT_FORM}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        const removed = events.find((item) => item.id === event);
        if (!removed) return;
        void action.run(
          () => removeCultureEvent({ data: { experiment, event } }),
          m.culture_event_not_removed(),
          {
            onSuccess: () => {
              toast.success(
                m.culture_event_removed({ event: describe(removed) }),
              );
              onDone();
            },
            invalidate: () => router.invalidate(),
          },
        );
      }}
    >
      <Form.Field label={m.culture_event_label()} required>
        <Select
          disabled={action.busy}
          options={events.map((item) => ({
            label: describe(item),
            value: item.id,
          }))}
          value={event}
          onChange={setEvent}
        />
      </Form.Field>
    </Form>
  );
}
