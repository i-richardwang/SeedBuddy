import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { TrainingRunOverview } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { IdentifierName } from "../../ui/IdentifierName";
import { CopyButton } from "../../ui/kit/CopyButton";
import { Progress } from "../../ui/kit/Progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { Tooltip } from "../../ui/kit/Tooltip";
import { Metric } from "../../ui/Metric";
import { TrainingRunState } from "./TrainingRunState";

/**
 * Training runs, each with its own status column; across training sets
 * (`datasetColumn`) each run names its set. `empty` stands in for no runs.
 */
export function TrainingRunsTable({
  runs,
  datasetColumn = false,
  empty,
}: {
  runs: TrainingRunOverview[];
  datasetColumn?: boolean;
  empty: ReactNode;
}) {
  return (
    <Table
      aria-label={m.training_runs()}
      narrow="cards"
      empty={runs.length === 0 ? empty : undefined}
    >
      <TableHeader>
        <tr>
          <TableHead>{m.run_column_run()}</TableHead>
          <TableHead>{m.status_label()}</TableHead>
          {datasetColumn && <TableHead>{m.dataset_label()}</TableHead>}
          <TableHead className="w-32" numeric>
            {m.parameter_epochs()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.metric_best_map50()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.metric_best_map50_95()}
          </TableHead>
          <TableHead className="w-48">{m.version_label()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {runs.map(({ dataset, run, completed, best }) => (
          <TableRow key={run.id} clickable>
            <TableCell cellSlot="title">
              <IdentifierName
                id={run.id}
                render={
                  <TextLink
                    render={
                      <Link
                        to="/datasets/$dataset/runs/$runId"
                        params={{ dataset: dataset.id, runId: run.id }}
                      />
                    }
                  />
                }
              />
            </TableCell>
            <TableCell cellLabel={m.status_label()}>
              <Tooltip
                title={run.state.status === "failed" ? run.state.error : null}
              >
                <TrainingRunState run={run} />
              </Tooltip>
            </TableCell>
            {datasetColumn && (
              <TableCell cellLabel={m.dataset_label()}>
                {dataset.name}
              </TableCell>
            )}
            <TableCell cellLabel={m.parameter_epochs()} numeric>
              <EpochProgress
                completed={completed}
                total={run.recipe.parameters.epochs}
              />
            </TableCell>
            <TableCell cellLabel={m.metric_best_map50()} numeric>
              <Metric value={best?.map50 ?? null} />
            </TableCell>
            <TableCell cellLabel={m.metric_best_map50_95()} numeric>
              <Metric value={best?.map50To95 ?? null} />
            </TableCell>
            <TableCell cellLabel={m.version_label()}>
              {run.state.status === "succeeded" ? (
                <IdentifierName id={run.state.modelVersionId} />
              ) : (
                <Absent />
              )}
            </TableCell>
            <TableCell cellSlot="actions">
              <CopyButton content={run.id} title={m.run_copy_id()} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Completed epochs over the planned number, with a thin bar under them. */
function EpochProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  return (
    <span className="inline-flex w-24 flex-col items-stretch gap-1">
      {m.progress_count({ completed, total })}
      <Progress
        aria-label={m.parameter_epochs()}
        size="small"
        value={completed}
        max={total}
      />
    </span>
  );
}
