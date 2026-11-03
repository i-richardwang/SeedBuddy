import {
  createFileRoute,
  notFound,
  stripSearchParams,
} from "@tanstack/react-router";
import { z } from "zod";

import type { ExperimentGridDetail } from "../../domain/experiments/read-model";
import { experimentIdSchema } from "../../domain/experiments/schema";
import {
  EXPERIMENT_TABS,
  ExperimentView,
} from "../../features/experiments/ExperimentView";
import { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import {
  PageHeaderSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "../../ui/kit/PageSkeleton";
import { PageColumnSkeleton } from "../../ui/Page";

/** The units' tab is on show unless the address names another. */
const searchDefaults = { tab: "units" } as const;

const experimentSearchSchema = z.object({
  tab: z
    .enum(EXPERIMENT_TABS)
    .default(searchDefaults.tab)
    .catch(searchDefaults.tab),
});

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  validateSearch: experimentSearchSchema,
  search: { middlewares: [stripSearchParams(searchDefaults)] },
  loader: async ({ params }) => {
    if (!experimentIdSchema.safeParse(params.experiment).success) {
      throw notFound();
    }
    const grid = await getExperimentGrid({
      data: { experiment: params.experiment },
    });
    if (!grid) throw notFound();
    return grid;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment } = loaderData as ExperimentGridDetail;
      return [
        { label: m.experiments_title(), href: "/experiments" },
        { label: experiment.name },
      ];
    },
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData?.experiment.name) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton icon meta />
      <TabsSkeleton tabs={3} />
      <TableSkeleton />
    </PageColumnSkeleton>
  ),
  component: ExperimentPage,
});

function ExperimentPage() {
  const { tab } = Route.useSearch();
  const data = Route.useLoaderData();
  useRouteRefresh(
    5000,
    data.images.some((image) => image.state === "pending"),
  );
  const navigate = Route.useNavigate();
  return (
    <ExperimentView
      data={data}
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
