import { Trash2 } from "lucide-react";

import type { PhotoBatch } from "../../domain/photos/schema";
import { removePhotoBatch } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { toast } from "../../ui/kit/Toast";

/** A batch page's secondary actions: deleting it with whatever still waits in it. */
export function PhotoBatchMenu({
  batch,
  photoCount,
}: {
  batch: PhotoBatch;
  photoCount: number;
}) {
  const confirmDestructive = useConfirmDestructive();
  const navigateAfterWrite = useNavigateAfterWrite();
  return (
    <PageMenu
      label={m.item_actions({ name: batch.name })}
      items={[
        {
          key: "delete",
          icon: Trash2,
          danger: true,
          label: m.photo_batch_menu_delete(),
          onClick: () =>
            confirmDestructive({
              title: m.item_delete_title({ name: batch.name }),
              content:
                photoCount > 0
                  ? m.photo_batch_delete_content({ count: photoCount })
                  : undefined,
              confirmLabel: m.photo_batch_delete(),
              failure: m.photo_batch_not_deleted(),
              invalidate: false,
              onConfirm: async () => {
                await removePhotoBatch({ data: { batch: batch.id } });
              },
              onSuccess: async () => {
                toast.success(m.item_deleted({ name: batch.name }));
                await navigateAfterWrite({ to: "/photos" });
              },
            }),
        },
      ]}
    />
  );
}
