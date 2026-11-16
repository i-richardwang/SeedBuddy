import type { BatchPhotoOverview } from "../../domain/photos/read-model";
import { m } from "../../paraglide/messages";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { PreviewMedia } from "../../ui/kit/PreviewLayout";
import { previewSrc } from "../../ui/viewport/picture";

/** One waiting photograph beside the list: the picture and how large it is. */
export function BatchPhotoPreview({ photo }: { photo: BatchPhotoOverview }) {
  return (
    <>
      <PreviewMedia src={previewSrc(photo.digest)} alt={photo.filename} />
      <Descriptions>
        <DescriptionsItem label={m.photo_batch_column_dimensions()}>
          {m.photo_batch_dimensions({
            width: photo.width,
            height: photo.height,
          })}
        </DescriptionsItem>
      </Descriptions>
    </>
  );
}
