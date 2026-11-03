import {
  createFileRoute,
  notFound,
  stripSearchParams,
} from "@tanstack/react-router";
import { Beaker, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { placedPhotos } from "../../domain/experiments/photos";
import type { ExperimentGridDetail } from "../../domain/experiments/read-model";
import { experimentIdSchema } from "../../domain/experiments/schema";
import { gridSummary } from "../../domain/experiments/sheet";
import { ExperimentMenu } from "../../features/experiments/ExperimentMenu";
import { RecordObservationDialog } from "../../features/experiments/RecordObservationDialog";
import { TreatmentSummary } from "../../features/experiments/TreatmentSummary";
import { TreatmentsTable } from "../../features/experiments/TreatmentsTable";
import { UnitsTable } from "../../features/experiments/UnitsTable";
import { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "../../ui/kit/PageSkeleton";
import { Tabs } from "../../ui/kit/Tabs";
import { Page, PageColumnSkeleton } from "../../ui/Page";

/** The units' tab is on show unless the address names another. */
const EXPERIMENT_TABS = ["units", "summary", "treatments"] as const;

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
        { label: m.experiments_label(), href: "/experiments" },
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
  const navigate = Route.useNavigate();
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    manualReadings,
    models,
  } = data;
  const [recording, setRecording] = useState(false);
  const placed = placedPhotos(data);
  const summary = gridSummary(data);
  const summaryEmpty =
    !observations.length || !summary.cells.some((cell) => cell.count !== null);
  const hasRecords =
    images.length > 0 ||
    manualReadings.length > 0 ||
    units.some((unit) => unit.events.length > 0);
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
          {tab !== "summary" || !summaryEmpty ? (
            <Button
              type="primary"
              icon={Plus}
              onClick={() => setRecording(true)}
            >
              {m.observation_record()}
            </Button>
          ) : null}
          <ExperimentMenu experiment={experiment} hasRecords={hasRecords} />
        </>
      }
    >
      <Tabs
        activeKey={tab}
        items={[
          { key: "units", label: m.units_label() },
          { key: "summary", label: m.experiment_summary() },
          { key: "treatments", label: m.treatments_label() },
        ]}
        onChange={(next) =>
          void navigate({ search: { tab: next }, replace: true })
        }
      />
      {tab === "units" ? (
        <UnitsTable data={data} />
      ) : tab === "summary" ? (
        <TreatmentSummary
          treatments={treatments}
          units={units}
          observations={observations}
          summary={summary}
          empty={
            <EmptyPlace variant="outlined">
              <Empty
                title={m.summary_empty()}
                description={m.summary_empty_description()}
                action={
                  <Button type="primary" onClick={() => setRecording(true)}>
                    {m.observation_record()}
                  </Button>
                }
              />
            </EmptyPlace>
          }
        />
      ) : (
        <TreatmentsTable
          experiment={experiment.id}
          treatments={treatments}
          units={units}
        />
      )}

      <RecordObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        observations={observations}
        units={units}
        placed={placed}
        open={recording}
        onClose={() => setRecording(false)}
      />
    </Page>
  );
}
