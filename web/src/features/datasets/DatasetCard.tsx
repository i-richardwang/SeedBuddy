import { Link } from "@tanstack/react-router";
import { Images } from "lucide-react";

import type { DatasetOverview } from "../../domain/datasets/read-model";
import { m } from "../../paraglide/messages";
import { SummaryCard, SummaryCardStats } from "../../ui/kit/SummaryCard";
import { formatCount } from "../../ui/numbers";
import { datasetImageStateLabel } from "./labels";

/** A training set on its model's page: its images, and how many are reviewed and so can train. */
export function DatasetCard({
  dataset,
  imageCount,
  reviewedCount,
}: DatasetOverview) {
  return (
    <SummaryCard
      icon={Images}
      title={dataset.name}
      render={<Link to="/datasets/$dataset" params={{ dataset: dataset.id }} />}
      footer={
        <SummaryCardStats
          items={[
            { label: m.dataset_images(), value: formatCount(imageCount) },
            {
              label: datasetImageStateLabel("reviewed"),
              value: formatCount(reviewedCount),
            },
          ]}
        />
      }
    />
  );
}
