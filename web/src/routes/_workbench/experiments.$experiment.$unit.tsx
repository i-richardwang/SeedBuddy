import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import type { UnitDetail } from "../../domain/experiments/read-model";
import {
  observationIdSchema,
  unitRefSchema,
} from "../../domain/experiments/schema";
import {
  UnitWorkbench,
  UnitWorkbenchSkeleton,
} from "../../features/experiments/UnitWorkbench";
import { getUnitDetail } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";

/**
 * An observation the link cannot name is no observation: the newest with a
 * photograph shows. `show` names the reading on view; the best shows otherwise.
 * `compare` names the day shown beside the one in view.
 */
const unitSearchSchema = z.object({
  observation: observationIdSchema.optional().catch(undefined),
  compare: observationIdSchema.optional().catch(undefined),
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$unit",
)({
  validateSearch: unitSearchSchema,
  loaderDeps: ({ search }) => ({ observation: search.observation }),
  loader: async ({ params, deps }) => {
    const ref = unitRefSchema.safeParse({
      experiment: params.experiment,
      unit: params.unit,
    });
    if (!ref.success) throw notFound();
    const series = await getUnitDetail({
      data: { ...ref.data, ...deps },
    });
    if (!series) throw notFound();
    return series;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment, unit } = loaderData as UnitDetail;
      return [
        { label: m.experiments_title(), href: "/experiments" },
        { label: experiment.name, href: `/experiments/${experiment.id}` },
        { label: unit.code },
      ];
    },
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData &&
            m.unit_title({
              code: loaderData.unit.code,
              experiment: loaderData.experiment.name,
            }),
        ),
      },
    ],
  }),
  pendingComponent: UnitPageSkeleton,
  component: UnitPage,
});

function UnitPage() {
  const { datasets, ...series } = Route.useLoaderData();
  const { show, compare } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <UnitWorkbench
      series={series}
      datasets={datasets}
      show={show}
      onShowChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
      compare={compare}
      onCompareChange={(compare) =>
        void navigate({ search: (previous) => ({ ...previous, compare }) })
      }
    />
  );
}

function UnitPageSkeleton() {
  const { compare } = Route.useSearch();
  return <UnitWorkbenchSkeleton comparing={compare !== undefined} />;
}
