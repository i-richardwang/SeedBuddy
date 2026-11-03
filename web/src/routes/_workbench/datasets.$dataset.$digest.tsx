import { createFileRoute, linkOptions, notFound } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import type {
  DatasetImageDetail,
  DatasetImageStep,
} from "../../domain/datasets/read-model";
import { datasetImageRefSchema } from "../../domain/datasets/schema";
import {
  ImageWorkbench,
  ImageWorkbenchSkeleton,
} from "../../features/annotation/ImageWorkbench";
import { useWorkbenchKeys } from "../../features/annotation/keys";
import { splitLabel } from "../../features/datasets/labels";
import { datasetCrumbs } from "../../features/models/crumbs";
import { getDatasetImage } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { useStep } from "../../ui/hooks/useStep";
import { DescriptionsItem } from "../../ui/kit/Descriptions";
import { Text } from "../../ui/kit/Text";
import { modelName } from "../../ui/model-names";
import { Stepper } from "../../ui/Stepper";
import { WorkbenchFooter } from "../../ui/shell/Workbench";

/** `show` names the reading on view; the best shows otherwise. */
const datasetImageSearchSchema = z.object({
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/datasets/$dataset/$digest")({
  validateSearch: datasetImageSearchSchema,
  loader: async ({ params }) => {
    const ref = datasetImageRefSchema.safeParse(params);
    if (!ref.success) throw notFound();
    const view = await getDatasetImage({ data: ref.data });
    if (!view) throw notFound();
    return view;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { dataset, model, review } = loaderData as DatasetImageDetail;
      return [...datasetCrumbs(model, dataset), { label: review.filename }];
    },
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData &&
            m.image_title({
              file: loaderData.review.filename,
              dataset: loaderData.dataset.id,
            }),
        ),
      },
    ],
  }),
  pendingComponent: ImageWorkbenchSkeleton,
  component: DatasetImagePage,
});

/** The picture a dataset image's page frames. */
const shownPictures = (loaderData: unknown) => {
  const view = loaderData as DatasetImageDetail | undefined;
  return view ? [view.review.ref.digest] : [];
};

function DatasetImagePage() {
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
  } = Route.useLoaderData();
  const { show } = Route.useSearch();
  const navigate = Route.useNavigate();
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
      onShowChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
      onNext={stepTo(nextUnreviewed)}
      stepping={pending}
      context={{
        steps: (
          <WorkbenchFooter label={m.image_steps()}>
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
