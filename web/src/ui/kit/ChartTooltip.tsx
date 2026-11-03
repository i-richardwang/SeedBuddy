import { Circle } from "lucide-react";
import type { ReactNode } from "react";

import { Icon } from "./Icon";

/*
 * The tooltip of the charts: a frame, a header with the hovered label, and
 * one row per series (marker, name, value) in series order.
 */

export interface ChartTooltipRow {
  color: string;
  label: string;
  value: string;
}

export function ChartTooltip({
  rows,
  title,
}: {
  rows: ChartTooltipRow[];
  title: ReactNode;
}) {
  return (
    <div className="ui-chart-tooltip">
      <div className="ui-chart-tooltip-header">{title}</div>
      <div className="ui-chart-tooltip-rows">
        {rows.map((row) => (
          <div className="ui-chart-tooltip-row" key={row.label}>
            <div className="ui-chart-tooltip-row-name">
              <Icon
                fill="currentColor"
                icon={Circle}
                size={10}
                style={{ color: row.color }}
              />
              <span className="ui-chart-tooltip-row-title">{row.label}</span>
            </div>
            <span className="ui-chart-tooltip-row-number">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
