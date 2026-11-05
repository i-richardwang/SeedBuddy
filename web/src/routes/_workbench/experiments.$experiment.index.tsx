import {
  createFileRoute,
  notFound,
  redirect,
  stripSearchParams,
} from "@tanstack/react-router";
import { Beaker, Plus } from "lucide-react";
import { z } from "zod";

import {
  EXPERIMENT_TABS,
  type ExperimentFrame,
  type ExperimentView,
  type PhotoSlots,
} from "../../domain/experiments/read-model";
import {
  DEFAULT_UNIT_PAGE_SIZE,
  experimentIdSchema,
  treatmentIdSchema,
} from "../../domain/experiments/schema";
import { ExperimentMenu } from "../../features/experiments/ExperimentMenu";
import { RecordObservationDialog } from "../../features/experiments/RecordObservationDialog";
import { useReadingProgress } from "../../features/experiments/reading-progress";
import { TreatmentSummary } from "../../features/experiments/TreatmentSummary";
import { TreatmentsTable } from "../../features/experiments/TreatmentsTable";
import { UnitsTable } from "../../features/experiments/UnitsTable";
import {
  unitTablePageSchema,
  unitTableSearch,
  unitTableSizeSchema,
} from "../../features/experiments/unit-table";
import { getExperimentPage, getPhotoSlots } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { documentTitle } from "../../ui/documentTitle";
import { found } from "../../ui/found";
import { useLoadedDialog } from "../../ui/hooks/useLoadedDialog";
import { Button } from "../../ui/kit/Button";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "../../ui/kit/PageSkeleton";
import { Tabs } from "../../ui/kit/Tabs";
import { Page, PageColumnSkeleton } from "../../ui/Page";

/**
 * The address names what the page shows: the tab, and on the units' tab the
 * treatment they are narrowed to, the page, and how many units a page holds.
 * Each is left out while it holds its default.
 */
const searchDefaults = {
  tab: "units",
  page: 1,
  size: DEFAULT_UNIT_PAGE_SIZE,
} as const;

const experimentSearchSchema = z.object({
  tab: z
    .enum(EXPERIMENT_TABS)
    .default(searchDefaults.tab)
    .catch(searchDefaults.tab),
  treatment: treatmentIdSchema.optional().catch(undefined),
  page: unitTablePageSchema,
  size: unitTableSizeSchema,
});

type ExperimentSearch = z.infer<typeof experimentSearchSchema>;

/**
 * What the address asks the page to show. Only the units' tab reads the
 * treatment, the page and its size; the other tabs ignore them.
 */
function viewOf(search: ExperimentSearch): ExperimentView {
  return search.tab === "units"
    ? {
        tab: "units",
        units: {
          treatment: search.treatment ?? null,
          page: search.page,
          pageSize: search.size,
        },
      }
    : { tab: search.tab };
}

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  validateSearch: experimentSearchSchema,
  search: { middlewares: [stripSearchParams(searchDefaults)] },
  loaderDeps: ({ search }) => viewOf(search),
  loader: async ({ params, deps: view }) => {
    if (!experimentIdSchema.safeParse(params.experiment).success) {
      throw notFound();
    }
    const page = await getExperimentPage({
      data: { experiment: params.experiment, view },
    });
    if (!page) throw notFound();
    // A page of units the address cannot show gives way to the nearest one
    // it can.
    if ("instead" in page) {
      throw redirect({
        to: "/experiments/$experiment",
        params,
        search: { tab: "units", ...unitTableSearch(page.instead) },
        replace: true,
      });
    }
    return page;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { frame } = loaderData as { frame: ExperimentFrame };
      return [
        { label: m.experiments_label(), href: "/experiments" },
        { label: frame.experiment.name },
      ];
    },
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData?.frame.experiment.name) }],
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
  const { frame, models, view } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { experiment, treatments, observations } = frame;
  // A new observation's photographs are matched to the experiment's units,
  // read when one is recorded rather than with every page.
  const recording = useLoadedDialog<{ record: PhotoSlots }>();
  const record = () =>
    recording.show(
      "record",
      async () =>
        found(await getPhotoSlots({ data: { experiment: experiment.id } })),
      m.experiment_units_not_loaded(),
    );
  useReadingProgress(frame);
  const summaryEmpty =
    view.tab === "summary" &&
    !view.summary.cells.some((cell) => cell.count !== null);
  return (
    <Page
      title={experiment.name}
      icon={Beaker}
      meta={[
        experiment.plantMaterial,
        experiment.explantType,
        experiment.baseMedium,
        m.experiment_meta_inoculated({
          day: formatDay(experiment.inoculatedOn),
        }),
      ].filter(Boolean)}
      actions={
        <>
          {!summaryEmpty ? (
            <Button
              type="primary"
              icon={Plus}
              loading={recording.loading}
              onClick={record}
            >
              {m.observation_record()}
            </Button>
          ) : null}
          <ExperimentMenu
            experiment={experiment}
            hasRecords={frame.hasRecords}
          />
        </>
      }
    >
      <Tabs
        activeKey={view.tab}
        items={[
          { key: "units", label: m.units_label() },
          { key: "summary", label: m.experiment_summary() },
          { key: "treatments", label: m.treatments_label() },
        ]}
        // The treatment, page and size belong to the units' tab, and are
        // left behind with it.
        onChange={(tab) => void navigate({ search: { tab }, replace: true })}
      />
      {view.tab === "units" ? (
        <UnitsTable
          // A selection belongs to the page it was made on.
          key={`${view.units.treatment ?? ""}:${view.units.page}:${view.units.pageSize}`}
          frame={frame}
          models={models}
          units={view.units}
          onPage={(next) =>
            void navigate({
              search: (previous) => ({ ...previous, ...next }),
            })
          }
        />
      ) : view.tab === "summary" ? (
        <TreatmentSummary
          treatments={treatments}
          observations={observations}
          summary={view.summary}
          empty={
            <EmptyPlace variant="outlined">
              <Empty
                title={m.summary_empty()}
                description={m.summary_empty_description()}
                action={
                  <Button
                    type="primary"
                    loading={recording.loading}
                    onClick={record}
                  >
                    {m.observation_record()}
                  </Button>
                }
              />
            </EmptyPlace>
          }
        />
      ) : (
        <TreatmentsTable experiment={experiment.id} treatments={treatments} />
      )}

      {recording.last ? (
        <RecordObservationDialog
          experiment={experiment.id}
          inoculatedOn={experiment.inoculatedOn}
          models={models}
          observations={observations}
          slots={recording.last.value}
          open={recording.open}
          onClose={recording.close}
        />
      ) : null}
    </Page>
  );
}
