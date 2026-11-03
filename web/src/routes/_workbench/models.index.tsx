import { createFileRoute } from "@tanstack/react-router";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

import { ModelsGrid } from "../../features/models/ModelsGrid";
import { NewModelDialog } from "../../features/models/NewModelDialog";
import { getModels } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGridSkeleton } from "../../ui/kit/SummaryCard";
import { Page, PageColumnSkeleton } from "../../ui/Page";

export const Route = createFileRoute("/_workbench/models/")({
  loader: () => getModels(),
  staticData: { crumbs: () => [{ label: m.models_label() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.models_label()) }],
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
      title={m.models_label()}
      description={m.models_description()}
      actions={entries.length > 0 ? create : undefined}
    >
      <ModelsGrid
        models={entries}
        empty={
          <Empty
            icon={Network}
            title={m.models_empty()}
            description={m.models_empty_description()}
            action={create}
          />
        }
      />
      <NewModelDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
