import { Link } from "@tanstack/react-router";
import { Search, SearchX, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { BatchPhotoOverview } from "../../domain/photos/read-model";
import type { PhotoBatch } from "../../domain/photos/schema";
import { removeBatchPhoto } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { useConfirmDestructive } from "../../ui/confirmDestructive";
import { usePagedSearch } from "../../ui/hooks/usePagedSearch";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { Pagination } from "../../ui/kit/Pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";

/** The photographs waiting in a batch, searched by file name; a name opens its preview. */
export function BatchPhotosTable({
  batch,
  photos,
  photo: selected,
  empty,
}: {
  batch: PhotoBatch;
  photos: BatchPhotoOverview[];
  /** The photograph previewed beside the table. */
  photo?: string;
  empty: ReactNode;
}) {
  const { query, setQuery, matches, shown, pagination } = usePagedSearch(
    photos,
    { text: (photo) => photo.filename },
  );
  return (
    <Table
      aria-label={m.photo_batch_photos_table({ batch: batch.name })}
      size="small"
      narrow="cards"
      toolbar={
        photos.length > 0 ? (
          <Input
            aria-label={m.photo_batch_search()}
            className="w-48"
            placeholder={m.photo_batch_search()}
            prefix={<Icon icon={Search} size={14} />}
            size="small"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        ) : undefined
      }
      footer={pagination ? <Pagination {...pagination} /> : undefined}
      empty={
        photos.length === 0 ? (
          empty
        ) : matches.length === 0 ? (
          <Empty
            icon={SearchX}
            title={m.photo_batch_no_matches()}
            description={m.photo_batch_no_matches_description()}
          />
        ) : undefined
      }
    >
      <TableHeader>
        <tr>
          <TableHead>{m.image_label()}</TableHead>
          <TableHead className="w-40">
            {m.photo_batch_column_dimensions()}
          </TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {shown.map((photo) => (
          <TableRow
            key={photo.digest}
            clickable
            data-state={photo.digest === selected ? "selected" : undefined}
          >
            <TableCell cellSlot="title">
              <TextLink
                className="block max-w-80 truncate"
                render={
                  <Link
                    to="/photos/$batch"
                    params={{ batch: batch.id }}
                    search={{ photo: photo.digest }}
                  />
                }
              >
                {photo.filename}
              </TextLink>
            </TableCell>
            <TableCell cellLabel={m.photo_batch_column_dimensions()}>
              {m.photo_batch_dimensions({
                width: photo.width,
                height: photo.height,
              })}
            </TableCell>
            <TableCell cellSlot="actions" className="text-end">
              <RemovePhotoButton batch={batch} photo={photo} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Takes one photograph out of a batch, after asking. */
function RemovePhotoButton({
  batch,
  photo,
}: {
  batch: PhotoBatch;
  photo: BatchPhotoOverview;
}) {
  const confirmDestructive = useConfirmDestructive();
  return (
    <ActionIcon
      icon={Trash2}
      size="small"
      title={m.remove_action()}
      onClick={() =>
        confirmDestructive({
          title: m.photo_batch_photo_remove_title({
            file: photo.filename,
            batch: batch.name,
          }),
          confirmLabel: m.remove_action(),
          failure: m.photo_batch_photo_not_removed(),
          onConfirm: async () => {
            await removeBatchPhoto({
              data: { batch: batch.id, digest: photo.digest },
            });
          },
          onSuccess: () => {
            toast.success(
              m.photo_batch_photo_removed({
                file: photo.filename,
                batch: batch.name,
              }),
            );
          },
        })
      }
    />
  );
}
