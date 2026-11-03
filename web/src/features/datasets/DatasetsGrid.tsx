import type { ComponentProps, ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { CardGrid } from "../../ui/kit/SummaryCard";
import { DatasetCard } from "./DatasetCard";
export function DatasetsGrid({
  datasets,
  empty,
}: {
  datasets: {
    dataset: ComponentProps<typeof DatasetCard>["dataset"];
    imageCount: number;
    reviewedCount: number;
  }[];
  empty: ReactNode;
}) {
  return (
    <CardGrid
      aria-label={m.model_datasets()}
      empty={datasets.length === 0 ? empty : undefined}
    >
      {datasets.map((entry) => (
        <DatasetCard
          key={entry.dataset.id}
          dataset={entry.dataset}
          images={entry.imageCount}
          reviewed={entry.reviewedCount}
        />
      ))}
    </CardGrid>
  );
}
