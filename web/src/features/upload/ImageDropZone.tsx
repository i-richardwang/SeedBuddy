import { ImageUp } from "lucide-react";
import type { ReactNode } from "react";

import {
  MAX_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_EXTENSIONS,
  sourceImageFileError,
} from "../../domain/images/canonical";
import { m } from "../../paraglide/messages";
import {
  DropZone,
  DropZoneFile,
  DropZoneFileList,
  type DropZoneFileStatus,
} from "../../ui/kit/DropZone";
import { toast } from "../../ui/kit/Toast";
import { formatPercent } from "../../ui/numbers";
import { imageFileErrorLabel } from "./labels";
import type { ListedImage } from "./state";

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
  const addFiles = (incoming: File[]) => {
    const accepted = incoming.filter((file) => {
      const error = sourceImageFileError(file);
      if (error)
        toast.error({
          title: file.name,
          description: imageFileErrorLabel(error),
        });
      return error === null;
    });
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
