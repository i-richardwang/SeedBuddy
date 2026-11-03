import type { ReactNode } from "react";

import type { DatasetOverview } from "../../domain/datasets/read-model";
import { m } from "../../paraglide/messages";
import { CardGrid } from "../../ui/kit/SummaryCard";
import { DatasetCard } from "./DatasetCard";
export function DatasetsGrid({
  datasets,
  empty,
}: {
  datasets: DatasetOverview[];
  empty: ReactNode;
}) {
  return (
    <CardGrid
      aria-label={m.model_datasets()}
      empty={datasets.length === 0 ? empty : undefined}
    >
      {datasets.map((entry) => (
        <DatasetCard key={entry.dataset.id} {...entry} />
      ))}
    </CardGrid>
  );
}
