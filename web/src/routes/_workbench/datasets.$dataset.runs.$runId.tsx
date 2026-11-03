import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";

import { identifierLabel } from "../../domain/identifiers/schema";
import { bestEpoch } from "../../domain/training/metrics";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  isTrainingRunActive,
  isTrainingRunResumable,
  type TrainingRun,
} from "../../domain/training/schema";
import { datasetCrumbs } from "../../features/models/crumbs";
import {
  EpochCharts,
  EpochChartsSkeleton,
} from "../../features/training/EpochCharts";
import {
  ParametersList,
  ParametersListSkeleton,
} from "../../features/training/ParametersList";
import { ResumeTrainingDialog } from "../../features/training/ResumeTrainingDialog";
import { useTrainingRunControl } from "../../features/training/run-control";
import { TrainingAttempts } from "../../features/training/TrainingAttempts";
import { TrainingRunMenu } from "../../features/training/TrainingRunMenu";
import { getTrainingRun } from "../../functions/training";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Card } from "../../ui/kit/Card";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { ProgressMeter } from "../../ui/kit/Progress";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { Metric } from "../../ui/Metric";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";
import { Timestamp } from "../../ui/Timestamp";

export const Route = createFileRoute(
  "/_workbench/datasets/$dataset/runs/$runId",
)({
  loader: async ({ params }) => {
    const detail = await getTrainingRun({
      data: { dataset: params.dataset, runId: params.runId },
    });
    if (!detail) throw notFound();
    return detail;
  },
  staticData: {
    crumbs: ({ params, loaderData }) => [
      ...datasetCrumbs(
        (loaderData as TrainingRunDetail).model,
        (loaderData as TrainingRunDetail).dataset,
      ),
      { label: identifierLabel(params.runId) },
    ],
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          m.training_run_page_title({
            run: identifierLabel(params.runId),
            dataset: loaderData?.dataset.name ?? "",
          }),
        ),
      },
    ],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton icon meta />
      <StatisticHeroSkeleton />
      <PageSectionSkeleton>
        <Card>
          <EpochChartsSkeleton />
        </Card>
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <Card>
          <ParametersListSkeleton />
        </Card>
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: TrainingRunPage,
});

function TrainingRunPage() {
  const detail = Route.useLoaderData();
  const { run, epochs, version, model, current } = detail;
  const live = isTrainingRunActive(run);
  const control = useTrainingRunControl(detail);

  // A run waiting for another of its model reads again as that one moves.
  useRouteRefresh(10_000, live || detail.blockedBy !== null);

  const best = bestEpoch(epochs);
  const total = run.recipe.parameters.epochs;
  const published =
    version && version.artifact.kind === "ultralytics" ? version : null;
  const placement = runPlacement(run);
  const lead = published
    ? m.training_kpi_published({ version: identifierLabel(published.id) })
    : best
      ? m.training_kpi_best_epoch({ epoch: best.epoch })
      : null;
  const saved =
    run.checkpoint && (live || isTrainingRunResumable(run))
      ? m.training_kpi_saved({ epoch: run.checkpoint.epoch })
      : null;

  return (
    <Page
      title={identifierLabel(run.id)}
      icon={ChartLine}
      status={
        <TrainingRunMenu
          run={run}
          blocked={detail.blockedBy !== null}
          control={control}
        />
      }
      actions={
        published && !current ? (
          <Button
            render={
              <Link
                to="/models/$model"
                params={{ model: model.id }}
                search={{ version: published.id }}
              />
            }
          >
            {m.versions_compare()}
          </Button>
        ) : undefined
      }
      meta={[
        run.recipe.baseModel.reference,
        m.training_runtime({
          framework: run.recipe.runtime.framework,
          version: run.recipe.runtime.version,
        }),
        <Timestamp key="created" value={run.createdAt} />,
        ...(placement ? [placement] : []),
      ]}
    >
      <StatisticHero
        title={m.training_kpi_best_map()}
        value={<Metric value={best?.map50To95 ?? null} />}
        facts={[lead, saved].filter((fact) => fact !== null)}
        aside={
          <ProgressMeter
            label={m.training_kpi_epochs()}
            count={m.run_epochs_progress({ completed: epochs.length, total })}
            value={epochs.length}
            max={total}
          />
        }
      />

      <PageSection title={m.training_curves()}>
        {epochs.length > 0 ? (
          <Card>
            <EpochCharts epochs={epochs} total={total} best={best} />
          </Card>
        ) : (
          <EmptyPlace variant="outlined">
            <Empty
              icon={ChartLine}
              title={
                live
                  ? m.training_waiting_first_epoch()
                  : m.training_no_epochs_finished()
              }
            />
          </EmptyPlace>
        )}
      </PageSection>

      <PageSection title={m.training_attempts()}>
        <TrainingAttempts detail={detail} control={control} />
      </PageSection>

      <PageSection title={m.training_parameters_heading()}>
        <Card>
          <ParametersList parameters={run.recipe.parameters} />
        </Card>
      </PageSection>
      {isTrainingRunResumable(run) ? (
        <ResumeTrainingDialog
          detail={detail}
          open={control.resuming}
          onClose={control.closeResume}
        />
      ) : null}
    </Page>
  );
}

/** Where a queued or running run runs, or will. */
function runPlacement({ state, targetWorkerId }: TrainingRun) {
  if (state.status === "running")
    return m.training_running_worker({ worker: state.workerId });
  if (state.status !== "queued") return null;
  return targetWorkerId
    ? m.training_waiting_worker({ worker: targetWorkerId })
    : m.training_waiting_auto();
}
