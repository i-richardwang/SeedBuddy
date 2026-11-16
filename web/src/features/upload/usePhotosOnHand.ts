import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { storePhoto } from "./client";
import {
  createPhotosOnHand,
  type PhotoOnHand,
  type PhotosOnHand,
  type StorePhoto,
} from "./photos-on-hand";

interface Options {
  /** How a file reaches the store; by default it is uploaded and nothing more. */
  store?: StorePhoto;
  onStored?: (digests: readonly string[]) => void;
}

/** A form's photographs on hand as one render sees them, with the means to change them. */
export interface PhotosOnHandView extends Pick<
  PhotosOnHand,
  "upload" | "take" | "remove"
> {
  photos: readonly PhotoOnHand[];
  storing: boolean;
  failed: boolean;
}

/**
 * A form's photographs on hand, for as long as the form is mounted: leaving
 * it cancels what is still on the wire. The options in force are those of
 * the latest render.
 */
export function usePhotosOnHand(options: Options = {}): PhotosOnHandView {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [onHand] = useState(() =>
    createPhotosOnHand({
      store: (...upload) => (latest.current.store ?? storePhoto)(...upload),
      onStored: (digests) => latest.current.onStored?.(digests),
    }),
  );
  useEffect(() => onHand.stop, [onHand]);
  const photos = useSyncExternalStore(
    onHand.subscribe,
    onHand.photos,
    onHand.photos,
  );
  return {
    photos,
    upload: onHand.upload,
    take: onHand.take,
    remove: onHand.remove,
    storing: photos.some((photo) => photo.state.status === "storing"),
    failed: photos.some((photo) => photo.state.status === "failed"),
  };
}
