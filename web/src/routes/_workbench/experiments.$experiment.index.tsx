import {
  createFileRoute,
  notFound,
  stripSearchParams,
} from "@tanstack/react-router";
import { z } from "zod";

import type { ExperimentGrid } from "../../domain/experiments/contracts";
import { experimentIdSchema } from "../../domain/experiments/schema";
import {
  EXPERIMENT_TABS,
  ExperimentGridView,
} from "../../features/experiments/ExperimentGridView";
import { getExperimentGrid } from "../../functions/experiments";
import { documentTitle } from "../../ui/documentTitle";
import { PageColumnSkeleton } from "../../ui/Page";
import { m } from "../../paraglide/messages";
import {
  PageHeaderSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "../../ui/kit/PageSkeleton";

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
      const { experiment } = loaderData as ExperimentGrid;
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
  const navigate = Route.useNavigate();
  return (
    <ExperimentGridView
      data={Route.useLoaderData()}
      tab={tab}
      onTabChange={(next) => navigate({ search: { tab: next }, replace: true })}
    />
  );
}
