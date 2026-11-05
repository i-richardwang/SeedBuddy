import {
  createFileRoute,
  defaultStringifySearch,
  notFound,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import { unitPageHolding } from "../../domain/experiments/paging";
import type { UnitDetail } from "../../domain/experiments/read-model";
import {
  DEFAULT_UNIT_PAGE_SIZE,
  observationIdSchema,
  treatmentIdSchema,
  unitRefSchema,
} from "../../domain/experiments/schema";
import {
  UnitWorkbench,
  UnitWorkbenchSkeleton,
} from "../../features/experiments/UnitWorkbench";
import {
  unitTableSearch,
  unitTableSizeSchema,
} from "../../features/experiments/unit-table";
import { getUnitDetail } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";

/**
 * An observation the link cannot name is no observation: the newest with a
 * photograph shows. `show` names the reading on view; the best shows otherwise.
 * `compare` names the day shown beside the one in view. `treatment` names the
 * treatment whose units the workbench steps through, as the experiment's
 * table was narrowed to it; every unit otherwise. `size` is how many units a
 * page of that table holds, so the way back lands on the page holding the
 * unit.
 */
const unitSearchSchema = z.object({
  observation: observationIdSchema.optional().catch(undefined),
  compare: observationIdSchema.optional().catch(undefined),
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
  treatment: treatmentIdSchema.optional().catch(undefined),
  size: unitTableSizeSchema,
});

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$unit",
)({
  validateSearch: unitSearchSchema,
  search: {
    // Stepping from unit to unit keeps the treatment and the page size. The
    // middleware would carry them over from whatever page a link is on, so
    // a link into the workbench from elsewhere names both.
    middlewares: [
      retainSearchParams(["treatment", "size"]),
      stripSearchParams({ size: DEFAULT_UNIT_PAGE_SIZE }),
    ],
  },
  loaderDeps: ({ search }) => ({
    observation: search.observation,
    treatment: search.treatment,
  }),
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
    // A treatment the unit is not of gives way to the stepping it can show.
    // An absent treatment is named as such, so the middleware does not
    // carry the old one over.
    if ("instead" in series) {
      throw redirect({
        to: "/experiments/$experiment/$unit",
        params,
        search: (previous) => ({
          ...previous,
          treatment: series.instead.treatment ?? undefined,
        }),
        replace: true,
      });
    }
    return series;
  },
  staticData: {
    crumbs: ({ loaderData, search }) => {
      const { experiment, unit, navigation } = loaderData as UnitDetail;
      const { size } = search as z.infer<typeof unitSearchSchema>;
      // Back to the page of the experiment's table that holds the unit.
      const table = defaultStringifySearch(
        unitTableSearch(unitPageHolding(navigation, size)),
      );
      return [
        { label: m.experiments_label(), href: "/experiments" },
        {
          label: experiment.name,
          href: `/experiments/${experiment.id}${table}`,
        },
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
  const { show, compare, size } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <UnitWorkbench
      series={series}
      datasets={datasets}
      table={unitPageHolding(series.navigation, size)}
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
