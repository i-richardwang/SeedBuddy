import { createFileRoute } from "@tanstack/react-router";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

import { ModelCard } from "../../features/models/ModelCard";
import { ModelDialog } from "../../features/models/ModelDialog";
import { getModelCatalogue } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGrid, CardGridSkeleton } from "../../ui/kit/SummaryCard";
import { Page, PageColumnSkeleton } from "../../ui/Page";

export const Route = createFileRoute("/_workbench/models/")({
  loader: () => getModelCatalogue(),
  staticData: { crumbs: () => [{ label: m.models_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.models_title()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <CardGridSkeleton />
    </PageColumnSkeleton>
  ),
  component: ModelsPage,
});

function ModelsPage() {
  const entries = Route.useLoaderData();
  const [creating, setCreating] = useState(false);
  const create = (
    <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
      {m.model_new()}
    </Button>
  );

  return (
    <Page
      title={m.models_title()}
      description={m.models_description()}
      actions={entries.length > 0 ? create : undefined}
    >
      <CardGrid
        aria-label={m.models_title()}
        empty={
          entries.length === 0 && (
            <Empty
              icon={Network}
              title={m.models_empty()}
              description={m.models_empty_description()}
              action={create}
            />
          )
        }
      >
        {entries.map((entry) => (
          <ModelCard
            key={entry.model.id}
            model={entry.model}
            records={entry.records}
          />
        ))}
      </CardGrid>
      <ModelDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
