import { useRouter } from "@tanstack/react-router";

import { createBatchPhoto } from "../../functions/photos";
import { storePhoto } from "../upload/client";
import { ImageDropZone } from "../upload/ImageDropZone";
import { usePhotosOnHand } from "../upload/usePhotosOnHand";

/**
 * Uploads photographs into a batch. A file has arrived once the batch holds
 * it, so one the batch turns back fails like any other upload, and closing
 * the page loses nothing that arrived. The list shows what is still on its
 * way or did not arrive; what arrived is in the batch's table, which is
 * reread whenever the batch gains a photograph.
 */
export function BatchUpload({ batch }: { batch: string }) {
  const router = useRouter();
  const onHand = usePhotosOnHand({
    store: async (file, onProgress, signal) => {
      const stored = await storePhoto(file, onProgress, signal);
      signal.throwIfAborted();
      await createBatchPhoto({
        data: { batch, digest: stored.digest, filename: file.name },
      });
      void router.invalidate();
      return stored;
    },
  });

  return (
    <ImageDropZone
      photos={onHand.photos.filter((photo) => photo.state.status !== "stored")}
      onUpload={onHand.upload}
      onRemove={onHand.remove}
      disabled={false}
    />
  );
}
