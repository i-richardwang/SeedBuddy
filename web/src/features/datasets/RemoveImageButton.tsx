import { Trash2 } from "lucide-react";

import type { NamedDataset } from "../../domain/datasets/schema";
import { removeFromDataset } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { toast } from "../../ui/kit/Toast";

/** Takes one image out of a dataset, after asking. */
export function RemoveImageButton({
  dataset,
  image,
}: {
  dataset: NamedDataset;
  image: { digest: string; filename: string };
}) {
  const confirmDestructive = useConfirmDestructive();

  return (
    <ActionIcon
      icon={Trash2}
      size="small"
      title={m.remove_action()}
      onClick={() =>
        confirmDestructive({
          title: m.dataset_remove_title({
            file: image.filename,
            dataset: dataset.name,
          }),
          confirmLabel: m.remove_action(),
          onConfirm: async () => {
            await removeFromDataset({
              data: { dataset: dataset.id, digests: [image.digest] },
            });
          },
          onSuccess: () => {
            toast.success(
              m.dataset_image_removed({
                file: image.filename,
                dataset: dataset.name,
              }),
            );
          },
        })
      }
    />
  );
}
