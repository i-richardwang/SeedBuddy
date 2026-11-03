import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";

import type { DatasetImageOverview } from "../../domain/datasets/read-model";
import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { PreviewMedia } from "../../ui/kit/PreviewLayout";
import { Status } from "../../ui/kit/Status";
import { previewSrc } from "../../ui/viewport/picture";
import { BoxCount, hasQualityNotes, ImageQuality } from "./ImageFacts";
import {
  datasetImageState,
  datasetImageStateLabel,
  datasetImageStateTone,
} from "./labels";

/** One image beside the list: the photograph, where it stands, and the way into its annotation. */
export function ImagePreview({
  dataset,
  image,
}: {
  dataset: string;
  image: DatasetImageOverview;
}) {
  const state = datasetImageState(image);
  return (
    <>
      <PreviewMedia src={previewSrc(image.digest)} alt={image.filename} />
      <Descriptions>
        <DescriptionsItem label={m.state_label()}>
          <Status tone={datasetImageStateTone(state)}>
            {datasetImageStateLabel(state)}
          </Status>
        </DescriptionsItem>
        <DescriptionsItem label={m.boxes_label()}>
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
