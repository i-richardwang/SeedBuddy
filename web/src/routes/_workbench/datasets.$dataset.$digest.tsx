import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import type { DatasetImageView } from "../../domain/datasets/image";
import { datasetImageRefSchema } from "../../domain/datasets/schema";
import { ImageWorkbenchSkeleton } from "../../features/annotation/ImageWorkbench";
import { DatasetImageWorkbench } from "../../features/datasets/DatasetImageWorkbench";
import { datasetCrumbs } from "../../features/models/crumbs";
import { getDatasetImage } from "../../functions/datasets";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";

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
      const { dataset, model, review } = loaderData as DatasetImageView;
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

function DatasetImagePage() {
  const view = Route.useLoaderData();
  const { show } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DatasetImageWorkbench
      view={view}
      show={show}
      onShowChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
    />
  );
}
