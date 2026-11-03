import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";

import type { ModelRecords } from "../../domain/models/contracts";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { SummaryCard, SummaryCardStats } from "../../ui/kit/SummaryCard";
import { formatList } from "../../ui/lists";
import { classLabel, modelName } from "../../ui/model-names";
import { formatCount } from "../../ui/numbers";

/** A model in the catalogue: the classes it counts, and the versions, training sets and runs it holds. */
export function ModelCard({
  model,
  records,
}: {
  model: Model;
  records: ModelRecords;
}) {
  return (
    <SummaryCard
      icon={Network}
      title={modelName(model)}
      description={formatList(model.classes.map(classLabel))}
      render={<Link to="/models/$model" params={{ model: model.id }} />}
      footer={
        <SummaryCardStats
          items={[
            {
              label: m.model_versions(),
              value: formatCount(records.versions),
            },
            {
              label: m.model_datasets(),
              value: formatCount(records.datasets),
            },
            {
              label: m.training_runs(),
              value: formatCount(records.trainingRuns),
            },
          ]}
        />
      }
    />
  );
}
