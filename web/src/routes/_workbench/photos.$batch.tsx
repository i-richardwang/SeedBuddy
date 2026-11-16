import { createFileRoute, notFound } from "@tanstack/react-router";
import { Camera, ImagePlus } from "lucide-react";
import { z } from "zod";

import type { PhotoBatchDetail } from "../../domain/photos/read-model";
import { photoBatchRefSchema } from "../../domain/photos/schema";
import { BatchPhotoPreview } from "../../features/photos/BatchPhotoPreview";
import { BatchPhotosTable } from "../../features/photos/BatchPhotosTable";
import { BatchUpload } from "../../features/photos/BatchUpload";
import { PhotoBatchMenu } from "../../features/photos/PhotoBatchMenu";
import { getPhotoBatchDetail } from "../../functions/photos";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { formatCount } from "../../ui/numbers";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";

/** `photo` names the photograph previewed beside the list. */
const batchSearchSchema = z.object({
  photo: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/photos/$batch")({
  validateSearch: batchSearchSchema,
  loader: async ({ params }) => {
    const ref = photoBatchRefSchema.safeParse(params);
    if (!ref.success) throw notFound();
    const detail = await getPhotoBatchDetail({ data: ref.data });
    if (!detail) throw notFound();
    return detail;
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      { label: m.photos_label(), href: "/photos" },
      { label: (loaderData as PhotoBatchDetail).batch.name },
    ],
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData &&
            m.photo_batch_page_title({ batch: loaderData.batch.name }),
        ),
      },
    ],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton icon description />
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: PhotoBatchPage,
});

function PhotoBatchPage() {
  const { photo } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { batch, photos } = Route.useLoaderData();

  const preview = photos.find((candidate) => candidate.digest === photo);
  const closePreview = () =>
    void navigate({
      search: (previous) => ({ ...previous, photo: undefined }),
    });

  return (
    <Page
      title={batch.name}
      icon={Camera}
      description={m.photo_batch_description()}
      actions={<PhotoBatchMenu batch={batch} photoCount={photos.length} />}
      preview={
        preview
          ? {
              title: preview.filename,
              content: <BatchPhotoPreview photo={preview} />,
              onClose: closePreview,
            }
          : null
      }
    >
      <PageSection title={m.photo_batch_add_photos()}>
        <BatchUpload key={batch.id} batch={batch.id} />
      </PageSection>
      <PageSection
        title={m.photo_batch_waiting()}
        extra={photos.length > 0 ? formatCount(photos.length) : undefined}
      >
        <BatchPhotosTable
          batch={batch}
          photos={photos}
          photo={photo}
          empty={
            <Empty
              icon={ImagePlus}
              title={m.photo_batch_empty()}
              description={m.photo_batch_empty_description()}
            />
          }
        />
      </PageSection>
    </Page>
  );
}
