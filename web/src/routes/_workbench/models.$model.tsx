import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router";
import { ChartLine, Images, Network, Upload } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { ModelDetail } from "../../domain/models/read-model";
import { DatasetsGrid } from "../../features/datasets/DatasetsGrid";
import { ImportDatasetDialog } from "../../features/datasets/ImportDatasetDialog";
import { ModelMenu } from "../../features/models/ModelMenu";
import { modelIsFree } from "../../features/models/records";
import { VersionDialog } from "../../features/models/VersionDialog";
import { VersionsTable } from "../../features/models/VersionsTable";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getModelDetail, getVersionComparison } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGridSkeleton } from "../../ui/kit/SummaryCard";
import { formatList } from "../../ui/lists";
import { classLabel, modelName } from "../../ui/model-names";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";

/** `version` names the version whose comparison with the current one is open. */
const modelSearchSchema = z.object({
  version: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/models/$model")({
  validateSearch: modelSearchSchema,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: async ({ params, deps }) => {
    const [overview, comparison] = await Promise.all([
      getModelDetail({ data: { model: params.model } }),
      deps.version
        ? getVersionComparison({
            data: { model: params.model, version: deps.version },
          })
        : null,
    ]);
    if (!overview) throw notFound();
    return { ...overview, comparison };
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      { label: m.models_title(), href: "/models" },
      { label: modelName((loaderData as ModelDetail).model) },
    ],
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData && modelName(loaderData.model)) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton icon meta />
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <CardGridSkeleton cards={1} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: ModelPage,
});

/**
 * One model, for whoever keeps it accurate: what it counts, its versions
 * with the one that reads and how each candidate compares with it, the
 * training sets that train it, and their runs.
 */
function ModelPage() {
  const { model, records, versions, datasets, runs, comparison } =
    Route.useLoaderData();
  const { version: selectedVersion } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [importing, setImporting] = useState(false);
  const compared = versions.find(
    ({ version, current }) => version.id === selectedVersion && !current,
  );

  useRouteRefresh(10_000);

  return (
    <Page
      title={modelName(model)}
      icon={Network}
      meta={[model.id, formatList(model.classes.map(classLabel))]}
      actions={<ModelMenu model={model} deletable={modelIsFree(records)} />}
    >
      <PageSection title={m.model_versions()}>
        <VersionsTable
          versions={versions}
          empty={
            <Empty
              icon={Network}
              title={m.versions_empty()}
              description={m.versions_empty_description()}
            />
          }
        />
      </PageSection>

      <PageSection
        title={m.model_datasets()}
        extra={
          <Button size="small" icon={Upload} onClick={() => setImporting(true)}>
            {m.dataset_import()}
          </Button>
        }
      >
        <DatasetsGrid
          datasets={datasets}
          empty={
            <Empty
              icon={Images}
              title={m.datasets_empty()}
              description={m.datasets_empty_description()}
              action={
                <Button render={<Link to="/experiments" />}>
                  {m.dataset_open_experiments()}
                </Button>
              }
            />
          }
        />
      </PageSection>

      <PageSection title={m.training_runs()}>
        <TrainingRunsTable
          runs={runs}
          datasetColumn
          empty={
            <Empty
              icon={ChartLine}
              title={m.run_empty_title()}
              description={m.run_empty_description()}
            />
          }
        />
      </PageSection>

      <VersionDialog
        model={model}
        version={compared?.version ?? null}
        comparison={comparison}
        onClose={() =>
          void navigate({ search: {}, replace: true, resetScroll: false })
        }
      />

      <ImportDatasetDialog
        open={importing}
        onClose={() => setImporting(false)}
      />
    </Page>
  );
}
