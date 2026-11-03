import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ChartLine,
  ImagePlus,
  Images,
  PenLine,
  Search,
  SearchX,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { QualityTags } from "../../ui/DetectionQuality";
import { UnclearTag } from "../../features/annotation/unclear";
import { Absent } from "../../ui/Absent";
import { Flexbox } from "../../ui/kit/Flex";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";
import { DatasetMenu } from "../../features/datasets/DatasetMenu";
import { RemoveImageButton } from "../../features/datasets/RemoveImageButton";
import {
  DATASET_IMAGE_STATE_TONE,
  DATASET_IMAGE_STATES,
  datasetImageState,
  datasetImageStateLabel,
  type DatasetImageState,
} from "../../features/datasets/labels";
import { formatCount } from "../../ui/numbers";
import { getDatasetOverview } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { Pagination } from "../../ui/kit/Pagination";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { PreviewMedia } from "../../ui/kit/PreviewLayout";
import { previewSrc } from "../../ui/viewport/picture";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { modelCrumbs } from "../../features/models/crumbs";
import { TrainButton } from "../../features/training/TrainButton";
import { TrainDialog, trainRefusal } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { Text } from "../../ui/kit/Text";

type DatasetOverview = NonNullable<
  Awaited<ReturnType<typeof getDatasetOverview>>
>;

type DatasetOverviewImage = DatasetOverview["images"][number];

/** `image` names the image previewed beside the list. */
const datasetSearchSchema = z.object({
  image: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  validateSearch: datasetSearchSchema,
  loader: async ({ params }) => {
    const overview = await getDatasetOverview({
      data: { dataset: params.dataset },
    });
    if (!overview) throw notFound();
    return overview;
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      ...modelCrumbs((loaderData as DatasetOverview).model),
      { label: (loaderData as DatasetOverview).dataset.name },
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

const PAGE_SIZE = 20;

type Filter = DatasetImageState | "all";

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { image: previewed } = Route.useSearch();
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  useRouteRefresh(10_000);

  const states = new Map(
    images.map((image) => [image.digest, datasetImageState(image)]),
  );
  const needle = query.trim().toLowerCase();
  const matches = images.filter(
    (image) =>
      (filter === "all" || states.get(image.digest) === filter) &&
      image.filename.toLowerCase().includes(needle),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const preview = images.find((image) => image.digest === previewed);
  const closePreview = () =>
    void navigate({
      search: (previous) => ({ ...previous, image: undefined }),
    });

  return (
    <Page
      title={name}
      icon={Images}
      action={
        <>
          <TrainButton refusal={refusal} onClick={() => setStarting(true)} />
          <DatasetMenu dataset={{ id: dataset, name }} />
        </>
      }
      preview={
        preview
          ? {
              title: preview.filename,
              content: (
                <ImagePreview
                  dataset={dataset}
                  image={preview}
                  state={states.get(preview.digest) ?? "unread"}
                />
              ),
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
        <Table
          aria-label={m.dataset_images_table({ dataset: name })}
          size="small"
          narrow="cards"
          toolbar={
            images.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={m.dataset_search()}
                  className="w-48"
                  placeholder={m.dataset_search()}
                  prefix={<Icon icon={Search} size={14} />}
                  size="small"
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
                <ToggleGroup
                  aria-label={m.dataset_state_filter()}
                  variant="outlined"
                  value={filter}
                  options={[
                    { value: "all", label: m.dataset_state_all() },
                    ...DATASET_IMAGE_STATES.map((state) => ({
                      value: state,
                      label: datasetImageStateLabel(state),
                    })),
                  ]}
                  onChange={(next) => {
                    setFilter(next);
                    setPage(1);
                  }}
                />
              </div>
            ) : undefined
          }
          footer={
            matches.length > PAGE_SIZE ? (
              <Pagination
                current={current}
                pageSize={PAGE_SIZE}
                total={matches.length}
                onChange={setPage}
              />
            ) : undefined
          }
          empty={
            images.length === 0 ? (
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
            ) : matches.length === 0 ? (
              <Empty
                icon={SearchX}
                title={m.dataset_no_matches()}
                description={m.dataset_no_matches_description()}
              />
            ) : undefined
          }
        >
          <TableHeader>
            <tr>
              <TableHead>{m.dataset_column_image()}</TableHead>
              <TableHead className="w-28">{m.dataset_column_state()}</TableHead>
              <TableHead className="w-1/4">
                {m.dataset_column_quality()}
              </TableHead>
              <TableHead className="w-20" numeric>
                {m.dataset_column_boxes()}
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{m.dataset_column_actions()}</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {shown.map((image) => {
              const state = states.get(image.digest) ?? "unread";
              return (
                <TableRow
                  key={image.digest}
                  clickable
                  data-state={
                    image.digest === previewed ? "selected" : undefined
                  }
                >
                  <TableCell cellSlot="title">
                    <TextLink
                      className="block max-w-80 truncate"
                      render={
                        <Link
                          to="/datasets/$dataset"
                          params={{ dataset }}
                          search={{ image: image.digest }}
                        />
                      }
                    >
                      {image.filename}
                    </TextLink>
                  </TableCell>
                  <TableCell cellLabel={m.dataset_column_state()}>
                    <Status tone={DATASET_IMAGE_STATE_TONE[state]}>
                      {datasetImageStateLabel(state)}
                    </Status>
                  </TableCell>
                  <TableCell cellLabel={m.dataset_column_quality()}>
                    <ImageQuality image={image} />
                  </TableCell>
                  <TableCell cellLabel={m.dataset_column_boxes()} numeric>
                    <BoxCount
                      detected={image.detectionCount}
                      proposed={image.proposalCount}
                      boxes={image.reviewCount}
                    />
                  </TableCell>
                  <TableCell cellSlot="actions" className="text-end">
                    <RemoveImageButton
                      dataset={{ id: dataset, name }}
                      image={image}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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

/** One image beside the list: the photograph, where it stands, and the way into its annotation. */
function ImagePreview({
  dataset,
  image,
  state,
}: {
  dataset: string;
  image: DatasetOverviewImage;
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

/** Whether anything is said against the image: the detector's warnings, or a person's mark. */
function hasQualityNotes(image: DatasetOverviewImage): boolean {
  return (
    (image.quality !== null && image.quality.status !== "ok") || image.unclear
  );
}

/** What is said against the image, or nothing. */
function ImageQuality({ image }: { image: DatasetOverviewImage }) {
  if (!hasQualityNotes(image)) return <Absent />;
  return (
    <Flexbox horizontal gap={4} wrap="wrap">
      {image.unclear ? <UnclearTag /> : null}
      {image.quality && image.quality.status !== "ok" ? (
        <QualityTags quality={image.quality} />
      ) : null}
    </Flexbox>
  );
}

/** A reviewer's count reads plain; an unreviewed proposal or detection reads tertiary. */
function BoxCount({
  detected,
  proposed,
  boxes,
}: {
  detected: number | null;
  proposed: number | null;
  boxes: number | null;
}) {
  if (boxes !== null) return <>{formatCount(boxes)}</>;
  const unreviewed = proposed ?? detected;
  return unreviewed === null ? (
    <Absent />
  ) : (
    <Text as="span" type="tertiary">
      {formatCount(unreviewed)}
    </Text>
  );
}
