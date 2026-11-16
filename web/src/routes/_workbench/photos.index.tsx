import { createFileRoute } from "@tanstack/react-router";
import { Camera, Plus } from "lucide-react";
import { useState } from "react";

import { NewPhotoBatchDialog } from "../../features/photos/NewPhotoBatchDialog";
import { PhotoBatchesTable } from "../../features/photos/PhotoBatchesTable";
import { getPhotoBatches } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { Page, PageColumnSkeleton } from "../../ui/Page";

export const Route = createFileRoute("/_workbench/photos/")({
  loader: () => getPhotoBatches(),
  staticData: { crumbs: () => [{ label: m.photos_label() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.photos_label()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <TableSkeleton />
    </PageColumnSkeleton>
  ),
  component: PhotosPage,
});

function PhotosPage() {
  const batches = Route.useLoaderData();
  const [creating, setCreating] = useState(false);
  const create = (
    <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
      {m.photo_batch_new()}
    </Button>
  );

  return (
    <Page
      title={m.photos_label()}
      description={m.photos_description()}
      actions={batches.length > 0 ? create : undefined}
    >
      <PhotoBatchesTable
        batches={batches}
        empty={
          <Empty
            icon={Camera}
            title={m.photo_batches_empty()}
            description={m.photo_batches_empty_description()}
            action={create}
          />
        }
      />
      <NewPhotoBatchDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
