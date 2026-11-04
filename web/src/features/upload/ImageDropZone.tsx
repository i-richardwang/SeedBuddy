import { ImageUp } from "lucide-react";
import type { ReactNode } from "react";

import {
  MAX_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
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
import type { ListedImage } from "./useUploads";

const FILE_STATUS = {
  storing: "uploading",
  stored: "done",
  failed: "error",
} as const satisfies Record<ListedImage["state"]["status"], DropZoneFileStatus>;

/**
 * Takes source images by drop or chooser and lists them as they upload.
 * Without `multiple` a new image replaces the one listed.
 */
export function ImageDropZone({
  images,
  onAdd,
  onRemove,
  disabled,
  annotate,
  multiple = true,
}: {
  images: ListedImage[];
  onAdd: (files: File[]) => void;
  onRemove: (id: number) => void;
  disabled: boolean;
  /** Controls placed on a listed image, before its remove button. */
  annotate?: (image: ListedImage) => ReactNode;
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
      onAdd(accepted);
      return;
    }
    for (const image of images) onRemove(image.id);
    onAdd(accepted.slice(0, 1));
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
        megapixels: MAX_SOURCE_IMAGE_PIXELS / 1_000_000,
      })}
      selectText={m.dropzone_select()}
      onFiles={addFiles}
    >
      {images.length > 0 && (
        <DropZoneFileList>
          {images.map((image) => {
            const { id, file, state } = image;
            return (
              <DropZoneFile
                key={id}
                name={file.name}
                size={file.size}
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
                actions={annotate?.(image)}
                onRemove={disabled ? undefined : () => onRemove(id)}
              />
            );
          })}
        </DropZoneFileList>
      )}
    </DropZone>
  );
}
