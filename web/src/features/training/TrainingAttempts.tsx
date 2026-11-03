import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  TRAINING_STALL_MINUTES,
  type TrainingRunStall,
} from "../../domain/training/stall";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { OverflowTooltip } from "../../ui/kit/Tooltip";
import { Timestamp } from "../../ui/Timestamp";
import type { TrainingRunControl } from "./run-control";
import { TrainingAttemptState } from "./TrainingRunState";

/**
 * Each time a Worker took the run up, the latest first, with how it ended
 * and why; the attempt under way has lost contact once its Worker no longer
 * holds the run, before the next claim records it so. What keeps the run
 * from moving stands over the table: a failure or a stall with the command
 * that moves it again when it will not move on its own, and another run of
 * its model in progress with the way to it.
 */
export function TrainingAttempts({
  detail: { run, stall, blockedBy, attempts },
  control,
  empty,
}: {
  empty: ReactNode;
  detail: TrainingRunDetail;
  control: TrainingRunControl;
}) {
  return (
    <>
      {run.state.status === "failed" ? (
        <Alert
          type="error"
          title={m.training_failed_title()}
          detail={run.state.error}
          action={
            <Button
              size="small"
              disabled={blockedBy !== null}
              onClick={control.resume}
            >
              {m.training_retry()}
            </Button>
          }
        />
      ) : null}
      {blockedBy ? (
        <Alert
          type="warning"
          title={m.training_blocked_title({
            run: identifierLabel(blockedBy.runId),
          })}
          description={m.training_blocked_description()}
          action={
            <Button
              size="small"
              render={
                <Link
                  to="/datasets/$dataset/runs/$runId"
                  params={{
                    dataset: blockedBy.datasetId,
                    runId: blockedBy.runId,
                  }}
                />
              }
            >
              {m.training_blocked_view()}
            </Button>
          }
        />
      ) : null}
      {run.state.status === "running" && stall ? (
        <StallAlert
          stall={stall}
          worker={run.state.workerId}
          pinned={run.targetWorkerId !== null}
          control={control}
        />
      ) : null}
      <Table
        aria-label={m.training_attempts()}
        size="small"
        empty={attempts.length === 0 ? empty : undefined}
      >
        <TableHeader>
          <tr>
            <TableHead>{m.attempt_column_number()}</TableHead>
            <TableHead>{m.worker_label()}</TableHead>
            <TableHead>{m.attempt_column_started()}</TableHead>
            <TableHead>{m.status_label()}</TableHead>
            <TableHead className="w-full">
              {m.attempt_column_reason()}
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {attempts.map((attempt) => (
            <TableRow key={attempt.attempt}>
              <TableCell className="whitespace-nowrap">
                {m.attempt_number({ attempt: attempt.attempt })}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {attempt.workerId}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Timestamp value={attempt.startedAt} />
              </TableCell>
              <TableCell>
                <TrainingAttemptState
                  outcome={
                    attempt.outcome === null &&
                    attempt.attempt === run.attempt &&
                    stall === "worker-lost"
                      ? "expired"
                      : attempt.outcome
                  }
                />
              </TableCell>
              <TableCell className="max-w-0">
                {attempt.error ? (
                  <OverflowTooltip title={attempt.error}>
                    <Text ellipsis>{attempt.error}</Text>
                  </OverflowTooltip>
                ) : (
                  <Absent />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

/**
 * Why a running run has stopped moving, and what moves it again. A lost
 * Worker hands an unpinned run to the next free one on its own; a pinned run
 * waits for its Worker, and one whose Worker holds it without progress waits
 * for no one, so both offer the pause that frees it for another.
 */
function StallAlert({
  stall,
  worker,
  pinned,
  control,
}: {
  stall: TrainingRunStall;
  worker: string;
  pinned: boolean;
  control: TrainingRunControl;
}) {
  const takenOver = stall === "worker-lost" && !pinned;
  return (
    <Alert
      type="warning"
      title={
        stall === "worker-lost"
          ? m.training_worker_lost({ worker })
          : m.training_stall_no_progress({ minutes: TRAINING_STALL_MINUTES })
      }
      description={
        takenOver
          ? m.training_stall_takeover()
          : stall === "worker-lost"
            ? m.training_stall_reconnect()
            : m.training_stall_move()
      }
      action={
        takenOver ? undefined : (
          <Button size="small" loading={control.busy} onClick={control.pause}>
            {m.training_pause()}
          </Button>
        )
      }
    />
  );
}
