import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PhotoBatchOverview } from "../../domain/photos/read-model";
import { m } from "../../paraglide/messages";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { formatCount } from "../../ui/numbers";
import { Timestamp } from "../../ui/Timestamp";

/** The reader's batches, the newest first, each with how many photographs wait in it. */
export function PhotoBatchesTable({
  batches,
  empty,
}: {
  batches: PhotoBatchOverview[];
  empty: ReactNode;
}) {
  return (
    <Table
      aria-label={m.photo_batches_table()}
      narrow="cards"
      empty={batches.length === 0 ? empty : undefined}
    >
      <TableHeader>
        <tr>
          <TableHead>{m.name_label({ kind: "thing" })}</TableHead>
          <TableHead className="w-28" numeric>
            {m.photos_label()}
          </TableHead>
          <TableHead className="w-56">
            {m.photo_batches_column_created()}
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => (
          <TableRow key={batch.id} clickable>
            <TableCell cellSlot="title">
              <TextLink
                className="block max-w-80 truncate"
                render={
                  <Link to="/photos/$batch" params={{ batch: batch.id }} />
                }
              >
                {batch.name}
              </TextLink>
            </TableCell>
            <TableCell cellLabel={m.photos_label()} numeric>
              {formatCount(batch.photoCount)}
            </TableCell>
            <TableCell cellLabel={m.photo_batches_column_created()}>
              <Timestamp value={batch.createdAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
