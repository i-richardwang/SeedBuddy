import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine, ImagePlus, Images } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { DatasetDetail } from "../../domain/datasets/read-model";
import { DatasetImagesTable } from "../../features/datasets/DatasetImagesTable";
import { DatasetMenu } from "../../features/datasets/DatasetMenu";
import { ImagePreview } from "../../features/datasets/ImagePreview";
import { modelCrumbs } from "../../features/models/crumbs";
import { TrainButton } from "../../features/training/TrainButton";
import { TrainDialog, trainRefusal } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getDatasetDetail } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { formatCount } from "../../ui/numbers";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";

/** `image` names the image previewed beside the list. */
const datasetSearchSchema = z.object({
  image: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  validateSearch: datasetSearchSchema,
  loader: async ({ params }) => {
    const overview = await getDatasetDetail({
      data: { dataset: params.dataset },
    });
    if (!overview) throw notFound();
    return overview;
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      ...modelCrumbs((loaderData as DatasetDetail).model),
      { label: (loaderData as DatasetDetail).dataset.name },
    ],
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData?.dataset.name) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton icon />
      <StatisticHeroSkeleton />
      <PageSectionSkeleton>
        <TableSkeleton />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: DatasetPage,
});

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { image } = Route.useSearch();
  const navigate = Route.useNavigate();
  const {
    dataset: { name },
    images,
    reviewedCount,
    training,
    trainingPresets,
    defaultTrainingPresetId,
    runs,
  } = Route.useLoaderData();
  const [starting, setStarting] = useState(false);
  const refusal = trainRefusal({ reviewed: reviewedCount, training });
  useRouteRefresh(10_000);

  const preview = images.find((candidate) => candidate.digest === image);
  const closePreview = () =>
    void navigate({
      search: (previous) => ({ ...previous, image: undefined }),
    });

  return (
    <Page
      title={name}
      icon={Images}
      actions={
        <>
          <TrainButton refusal={refusal} onClick={() => setStarting(true)} />
          <DatasetMenu dataset={{ id: dataset, name }} />
        </>
      }
      preview={
        preview
          ? {
              title: preview.filename,
              content: <ImagePreview dataset={dataset} image={preview} />,
              onClose: closePreview,
            }
          : null
      }
    >
      <StatisticHero
        value={formatCount(reviewedCount)}
        title={m.dataset_hero_reviewed()}
        facts={[
          m.dataset_hero_images({ count: images.length }),
          ...(training.reviewedSinceLastRun > 0
            ? [
                m.dataset_reviewed_since_last_run({
                  count: training.reviewedSinceLastRun,
                }),
              ]
            : []),
        ]}
      />
      <PageSection title={m.dataset_images()}>
        <DatasetImagesTable
          dataset={{ id: dataset, name }}
          empty={
            <Empty
              icon={ImagePlus}
              title={m.dataset_empty_images()}
              description={m.dataset_empty_images_description()}
              action={
                <Button render={<Link to="/experiments" />}>
                  {m.dataset_open_experiments()}
                </Button>
              }
            />
          }
          images={images}
          image={image}
        />
      </PageSection>
      <PageSection title={m.training_runs()}>
        <TrainingRunsTable
          runs={runs}
          empty={<Empty icon={ChartLine} title={m.run_empty_title()} />}
        />
      </PageSection>
      <TrainDialog
        set={{
          dataset,
          reviewed: reviewedCount,
          trainingPresets,
          defaultTrainingPresetId,
          training,
        }}
        open={starting}
        onClose={() => setStarting(false)}
      />
    </Page>
  );
}
