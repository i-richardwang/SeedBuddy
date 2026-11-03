import { Link } from "@tanstack/react-router";
import { Search, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import type { DatasetImageOverview } from "../../domain/datasets/read-model";
import type { NamedDataset } from "../../domain/datasets/schema";
import { m } from "../../paraglide/messages";
import { usePagedSearch } from "../../ui/hooks/usePagedSearch";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { Pagination } from "../../ui/kit/Pagination";
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
import { BoxCount, ImageQuality } from "./ImageFacts";
import {
  DATASET_IMAGE_STATE_TONE,
  DATASET_IMAGE_STATES,
  type DatasetImageState,
  datasetImageState,
  datasetImageStateLabel,
} from "./labels";
import { RemoveImageButton } from "./RemoveImageButton";

type Filter = DatasetImageState | "all";

/** Searchable images, with their review state, quality and count. */
export function DatasetImagesTable({
  dataset,
  empty,
  images,
  previewed,
}: {
  dataset: NamedDataset;
  empty: ReactNode;
  images: DatasetImageOverview[];
  previewed?: string;
}) {
  const states = new Map(
    images.map((image) => [image.digest, datasetImageState(image)]),
  );
  const { query, setQuery, filter, setFilter, matches, shown, pagination } =
    usePagedSearch<DatasetImageOverview, Filter>(images, {
      text: (image) => image.filename,
      initialFilter: "all",
      accepts: (image, filter) =>
        filter === "all" || states.get(image.digest) === filter,
    });
  return (
    <Table
      aria-label={m.dataset_images_table({ dataset: dataset.name })}
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
          empty
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
                      params={{ dataset: dataset.id }}
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
                <RemoveImageButton dataset={dataset} image={image} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
