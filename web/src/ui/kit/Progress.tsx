import { Progress as BaseProgress } from "@base-ui/react/progress";
import type { ReactNode } from "react";

import { cn } from "./cn";

/*
 * A determinate bar. It draws the ratio only; the number is written next to
 * it. `small` is the thin track that sits under a figure or in a table cell.
 */

export function Progress({
  value,
  max,
  className,
  size = "middle",
  "aria-label": label,
}: {
  value: number;
  max: number;
  className?: string;
  size?: "small" | "middle";
  "aria-label": string;
}) {
  return (
    <BaseProgress.Root
      aria-label={label}
      className={cn(
        "ui-progress",
        size === "small" && "ui-progress-small",
        className,
      )}
      max={max}
      value={value}
    >
      <BaseProgress.Track className="ui-progress-track">
        <BaseProgress.Indicator className="ui-progress-indicator" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

/**
 * Work under way, as a side figure: its `label` and the count done at the
 * ends of a line, the thin bar under them, and an optional `note` below.
 */
export function ProgressMeter({
  count,
  label,
  max,
  note,
  value,
}: {
  /** The count written out, such as "3 / 50". */
  count: ReactNode;
  label: string;
  max: number;
  note?: ReactNode;
  value: number;
}) {
  return (
    <div className="ui-progress-meter" role="status">
      <div className="ui-progress-meter-line">
        <span>{label}</span>
        <span className="ui-progress-meter-count">{count}</span>
      </div>
      <Progress aria-label={label} size="small" value={value} max={max} />
      {note != null ? (
        <span className="ui-progress-meter-note">{note}</span>
      ) : null}
    </div>
  );
}
