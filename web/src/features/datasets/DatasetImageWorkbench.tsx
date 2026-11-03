import { linkOptions } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import type { ReviewSource } from "../../domain/annotation/schema";
import type {
  DatasetImageDetail,
  DatasetImageStep,
} from "../../domain/datasets/read-model";
import { m } from "../../paraglide/messages";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { useStep } from "../../ui/hooks/useStep";
import { DescriptionsItem } from "../../ui/kit/Descriptions";
import { Text } from "../../ui/kit/Text";
import { modelName } from "../../ui/model-names";
import { Stepper } from "../../ui/Stepper";
import { WorkbenchFooter } from "../../ui/shell/Workbench";
import { ImageWorkbench } from "../annotation/ImageWorkbench";
import { useWorkbenchKeys } from "../annotation/keys";
import { splitLabel } from "./labels";

/** The picture a dataset image's page frames. */
const shownPictures = (loaderData: unknown) => {
  const view = loaderData as DatasetImageDetail | undefined;
  return view ? [view.review.ref.digest] : [];
};

export function DatasetImageWorkbench({
  view,
  show,
  onShowChange,
}: {
  view: DatasetImageDetail;
  show: ReviewSource | undefined;
  onShowChange: (show: ReviewSource | undefined) => void;
}) {
  const {
    dataset,
    model,
    review,
    unclear,
    split,
    position,
    previous,
    next,
    nextUnreviewed,
  } = view;
  const { detection } = review;

  useRouteRefresh(
    5000,
    (detection === null && review.annotation === null) ||
      review.progress !== null,
  );

  const { pending, step, warm } = useStep(shownPictures);
  const targetOf = (image: DatasetImageStep | null) =>
    image &&
    linkOptions({
      to: "/datasets/$dataset/$digest",
      params: { dataset: dataset.id, digest: image.digest },
    });
  const neighbors = [targetOf(previous), targetOf(next)];
  // The images an arrow key leads to are fetched while this one is read.
  const warmNeighbors = useEffectEvent(() => {
    for (const target of neighbors) if (target) void warm(target);
  });
  useEffect(() => warmNeighbors(), [review.ref.digest]);
  const stepTo = (image: DatasetImageStep | null) => {
    const target = targetOf(image);
    return target ? () => step(target) : undefined;
  };
  const toPrevious = stepTo(previous);
  const toNext = stepTo(next);
  useWorkbenchKeys({
    ArrowLeft: toPrevious,
    ArrowRight: toNext,
  });

  return (
    <ImageWorkbench
      title={m.image_title({ file: review.filename, dataset: dataset.name })}
      model={model}
      review={review}
      unclear={unclear}
      show={show}
      onShowChange={onShowChange}
      onNext={stepTo(nextUnreviewed)}
      stepping={pending}
      context={{
        steps: (
          <WorkbenchFooter label={m.dataset_images()}>
            <Stepper
              previous={{ label: m.image_previous(), onClick: toPrevious }}
              next={{ label: m.image_next(), onClick: toNext }}
            >
              {m.ui_step_position(position)}
            </Stepper>
            <Text as="span" size="sm" type="secondary" ellipsis>
              {modelName(model)}
            </Text>
          </WorkbenchFooter>
        ),
        facts: split ? (
          <DescriptionsItem label={m.image_split()}>
            {splitLabel(split)}
          </DescriptionsItem>
        ) : undefined,
      }}
    />
  );
}
