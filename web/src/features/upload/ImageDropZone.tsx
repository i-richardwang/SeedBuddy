import { ImageUp } from "lucide-react";
import type { ReactNode } from "react";

import {
  MAX_IMAGE_BYTES,
  MAX_UPLOADED_IMAGE_PIXELS,
  SOURCE_IMAGE_EXTENSIONS,
  sourceImageFileError,
} from "../../domain/images/canonical";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import {
  DropZone,
  DropZoneFile,
  DropZoneFileList,
  type DropZoneFileStatus,
} from "../../ui/kit/DropZone";
import { formatList } from "../../ui/lists";
import { formatPercent } from "../../ui/numbers";
import { imageFileErrorLabel } from "./labels";
import type { PhotoOnHand } from "./photos-on-hand";

const FILE_STATUS = {
  storing: "uploading",
  stored: "done",
  failed: "error",
} as const satisfies Record<PhotoOnHand["state"]["status"], DropZoneFileStatus>;

/**
 * Takes source images by drop or chooser and lists the photographs on hand,
 * those on their way to the store and those it holds. Without `multiple` a
 * new image replaces the one listed.
 */
export function ImageDropZone({
  photos,
  onUpload,
  onRemove,
  disabled,
  annotate,
  multiple = true,
}: {
  photos: readonly PhotoOnHand[];
  onUpload: (files: File[]) => void;
  onRemove: (id: number) => void;
  disabled: boolean;
  /** Controls placed on a listed photograph, before its remove button. */
  annotate?: (photo: PhotoOnHand) => ReactNode;
  multiple?: boolean;
}) {
  const { run } = useAsyncAction();
  const addFiles = (incoming: File[]) => {
    const rejected = incoming.flatMap((file) => {
      const error = sourceImageFileError(file);
      return error ? [{ file, error }] : [];
    });
    const accepted = incoming.filter(
      (file) => !rejected.some((item) => item.file === file),
    );
    if (rejected.length > 0) {
      void run(
        () => {
          throw new Error(
            formatList([
              ...new Set(
                rejected.map(({ error }) => imageFileErrorLabel(error)),
              ),
            ]),
          );
        },
        m.photos_not_added({
          files: formatList(rejected.map(({ file }) => file.name)),
        }),
        { invalidate: false },
      );
    }
    if (accepted.length === 0) return;
    if (multiple) {
      onUpload(accepted);
      return;
    }
    for (const photo of photos) onRemove(photo.id);
    onUpload(accepted.slice(0, 1));
  };

  return (
    <DropZone
      accept={SOURCE_IMAGE_EXTENSIONS.join(",")}
      disabled={disabled}
      icon={ImageUp}
      multiple={multiple}
      title={m.dropzone_label()}
      description={m.dropzone_limits({
        megabytes: MAX_IMAGE_BYTES / (1024 * 1024),
        megapixels: MAX_UPLOADED_IMAGE_PIXELS / 1_000_000,
      })}
      selectText={m.dropzone_select()}
      onFiles={addFiles}
    >
      {photos.length > 0 && (
        <DropZoneFileList>
          {photos.map((photo) => {
            const { id, filename, bytes, state } = photo;
            return (
              <DropZoneFile
                key={id}
                name={filename}
                size={bytes}
                status={FILE_STATUS[state.status]}
                progress={
                  state.status === "storing" ? state.progress : undefined
                }
                statusText={
                  state.status === "stored"
                    ? m.dropzone_ready()
                    : state.status === "failed"
                      ? state.reason
                      : formatPercent(state.progress)
                }
                actions={annotate?.(photo)}
                onRemove={disabled ? undefined : () => onRemove(id)}
              />
            );
          })}
        </DropZoneFileList>
      )}
    </DropZone>
  );
}
