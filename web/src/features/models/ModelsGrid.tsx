import type { ReactNode } from "react";

import type { ModelOverview } from "../../domain/models/read-model";
import { m } from "../../paraglide/messages";
import { CardGrid } from "../../ui/kit/SummaryCard";
import { ModelCard } from "./ModelCard";

export function ModelsGrid({
  models,
  empty,
}: {
  models: ModelOverview[];
  empty: ReactNode;
}) {
  return (
    <CardGrid
      aria-label={m.models_label()}
      empty={models.length === 0 ? empty : undefined}
    >
      {models.map((entry) => (
        <ModelCard key={entry.model.id} {...entry} />
      ))}
    </CardGrid>
  );
}
