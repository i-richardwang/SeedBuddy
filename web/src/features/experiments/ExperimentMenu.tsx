import { Download, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Experiment } from "../../domain/experiments/schema";
import { removeExperiment } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { toast } from "../../ui/kit/Toast";
import { ExperimentDialog } from "./ExperimentDialog";

/**
 * An experiment page's secondary actions. The workbook is served as an
 * attachment, so following it downloads the file and leaves the page open.
 */
export function ExperimentMenu({
  experiment,
  hasRecords,
}: {
  experiment: Experiment;
  hasRecords: boolean;
}) {
  const confirmDestructive = useConfirmDestructive();
  const navigateAfterWrite = useNavigateAfterWrite();
  const [editing, setEditing] = useState(false);

  const items: DropdownItem[] = [
    {
      key: "export",
      icon: Download,
      label: m.experiment_export(),
      href: `/experiments/${experiment.id}/workbook`,
    },
    { type: "divider" },
    {
      key: "edit",
      icon: Pencil,
      label: m.experiment_menu_edit(),
      onClick: () => setEditing(true),
    },
  ];
  if (!hasRecords) {
    items.push({
      key: "delete",
      icon: Trash2,
      danger: true,
      label: m.experiment_menu_delete(),
      onClick: () =>
        confirmDestructive({
          title: m.item_delete_title({ name: experiment.name }),
          confirmLabel: m.experiment_delete(),
          onConfirm: async () => {
            await removeExperiment({ data: { experiment: experiment.id } });
          },
          onSuccess: async () => {
            toast.success(m.item_deleted({ name: experiment.name }));
            await navigateAfterWrite({ to: "/experiments" });
          },
          invalidate: false,
        }),
    });
  }

  return (
    <>
      <PageMenu
        label={m.item_actions({ name: experiment.name })}
        items={items}
      />
      <ExperimentDialog
        experiment={experiment}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
