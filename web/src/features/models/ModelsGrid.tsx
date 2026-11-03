import type { ComponentProps, ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { CardGrid } from "../../ui/kit/SummaryCard";
import { ModelCard } from "./ModelCard";
export function ModelsGrid({
  entries,
  empty,
}: {
  entries: ComponentProps<typeof ModelCard>[];
  empty: ReactNode;
}) {
  return (
    <CardGrid
      aria-label={m.models_title()}
      empty={entries.length === 0 ? empty : undefined}
    >
      {entries.map((entry) => (
        <ModelCard key={entry.model.id} {...entry} />
      ))}
    </CardGrid>
  );
}
