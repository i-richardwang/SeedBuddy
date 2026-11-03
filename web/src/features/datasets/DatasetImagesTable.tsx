import { Link } from "@tanstack/react-router";
import { ImagePlus, PenLine, Search, SearchX } from "lucide-react";

import type { getDatasetDetail } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { QualityTags } from "../../ui/DetectionQuality";
import { usePagedSearch } from "../../ui/hooks/usePagedSearch";
import { Button } from "../../ui/kit/Button";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Empty } from "../../ui/kit/Empty";
import { Flexbox } from "../../ui/kit/Flex";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { Pagination } from "../../ui/kit/Pagination";
import { PreviewMedia } from "../../ui/kit/PreviewLayout";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { formatCount } from "../../ui/numbers";
import { previewSrc } from "../../ui/viewport/picture";
import { UnclearTag } from "../annotation/unclear";
import {
  DATASET_IMAGE_STATE_TONE,
  DATASET_IMAGE_STATES,
  type DatasetImageState,
  datasetImageState,
  datasetImageStateLabel,
} from "./labels";
import { RemoveImageButton } from "./RemoveImageButton";

type DatasetDetail = NonNullable<Awaited<ReturnType<typeof getDatasetDetail>>>;

type DatasetImageOverview = DatasetDetail["images"][number];

type Filter = DatasetImageState | "all";

/** Searchable images, with their review state, quality and count. */
export function DatasetImagesTable({
  dataset,
  name,
  images,
  previewed,
}: {
  dataset: string;
  name: string;
  images: DatasetImageOverview[];
  previewed?: string;
}) {
  const states = new Map(
    images.map((image) => [image.digest, datasetImageState(image)]),
  );
  const { query, setQuery, filter, setFilter, matches, shown, pagination } =
    usePagedSearch(images, {
      text: (image) => image.filename,
      initialFilter: "all" as Filter,
      accepts: (image, filter) =>
        filter === "all" || states.get(image.digest) === filter,
    });
  return (
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
              onChange={setFilter}
            />
          </div>
        ) : undefined
      }
      footer={pagination ? <Pagination {...pagination} /> : undefined}
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
          <TableHead className="w-1/4">{m.dataset_column_quality()}</TableHead>
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
              data-state={image.digest === previewed ? "selected" : undefined}
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
  );
}

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

/** Whether anything is said against the image: the detector's warnings, or a person's mark. */
function hasQualityNotes(image: DatasetImageOverview): boolean {
  return (
    (image.quality !== null && image.quality.status !== "ok") || image.unclear
  );
}

/** What is said against the image, or nothing. */
function ImageQuality({ image }: { image: DatasetImageOverview }) {
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
