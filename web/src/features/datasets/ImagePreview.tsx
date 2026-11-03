import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";

import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { PreviewMedia } from "../../ui/kit/PreviewLayout";
import { Status } from "../../ui/kit/Status";
import { previewSrc } from "../../ui/viewport/picture";
import {
  BoxCount,
  type DatasetImageOverview,
  hasQualityNotes,
  ImageQuality,
} from "./ImageFacts";
import {
  DATASET_IMAGE_STATE_TONE,
  type DatasetImageState,
  datasetImageStateLabel,
} from "./labels";

/** One image beside the list: the photograph, where it stands, and the way into its annotation. */
export function ImagePreview({
  dataset,
  image,
  state,
}: {
  dataset: string;
  image: DatasetImageOverview;
  state: DatasetImageState;
}) {
  return (
    <>
      <PreviewMedia src={previewSrc(image.digest)} alt={image.filename} />
      <Descriptions>
        <DescriptionsItem label={m.dataset_column_state()}>
          <Status tone={DATASET_IMAGE_STATE_TONE[state]}>
            {datasetImageStateLabel(state)}
          </Status>
        </DescriptionsItem>
        <DescriptionsItem label={m.dataset_preview_boxes()}>
          <BoxCount
            detected={image.detectionCount}
            proposed={image.proposalCount}
            boxes={image.reviewCount}
          />
        </DescriptionsItem>
        {hasQualityNotes(image) ? (
          <DescriptionsItem label={m.dataset_preview_quality()}>
            <ImageQuality image={image} />
          </DescriptionsItem>
        ) : null}
      </Descriptions>
      <Button
        block
        type="primary"
        icon={PenLine}
        render={
          <Link
            to="/datasets/$dataset/$digest"
            params={{ dataset, digest: image.digest }}
          />
        }
      >
        {m.dataset_preview_open()}
      </Button>
    </>
  );
}
