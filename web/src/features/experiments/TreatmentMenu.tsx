import { useRouter } from "@tanstack/react-router";
import { CopyPlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Treatment } from "../../domain/experiments/schema";
import { removeTreatment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { confirmDestructive } from "../../ui/confirmDestructive";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { toast } from "../../ui/kit/Toast";
import { RowMenu } from "../../ui/ActionsMenu";
import { ReplicatesDialog, TreatmentDialog } from "./TreatmentDialog";

type Action = "edit" | "replicates";

/** What can be done to one treatment of the design. */
export function TreatmentMenu({
  experiment,
  treatment,
  deletable,
}: {
  experiment: string;
  treatment: Treatment;
  /** The last treatment of an experiment is not offered for deletion. */
  deletable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  const items: DropdownItem[] = [
    {
      key: "replicates",
      icon: CopyPlus,
      label: m.treatment_menu_add_replicates(),
      onClick: () => setOpen("replicates"),
    },
    {
      key: "edit",
      icon: Pencil,
      label: m.treatment_menu_edit(),
      onClick: () => setOpen("edit"),
    },
  ];
  if (deletable) {
    items.push(
      { type: "divider" },
      {
        key: "delete",
        icon: Trash2,
        danger: true,
        label: m.treatment_menu_remove(),
        onClick: () =>
          confirmDestructive({
            title: m.treatment_delete_title({ name: treatment.name }),
            content: m.treatment_delete_note(),
            confirmLabel: m.treatment_delete(),
            onConfirm: async () => {
              await removeTreatment({
                data: { experiment, treatment: treatment.id },
              });
            },
            onSuccess: () => {
              toast.success(m.treatment_deleted({ name: treatment.name }));
            },
            invalidate: () => router.invalidate(),
          }),
      },
    );
  }

  return (
    <>
      <RowMenu
        label={m.treatment_actions({ name: treatment.name })}
        items={items}
      />
      <TreatmentDialog
        experiment={experiment}
        treatment={treatment}
        open={open === "edit"}
        onClose={close}
      />
      <ReplicatesDialog
        experiment={experiment}
        treatment={treatment}
        open={open === "replicates"}
        onClose={close}
      />
    </>
  );
}
