import { Circle } from "lucide-react";

import { Icon } from "./Icon";

/* The series legend of the charts: a marker and a name per series. */

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

/** The color of the series at zero-based `index`; past the last color the sequence repeats. */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

export function Legend({
  categories,
  labels,
}: {
  categories: string[];
  /** Display names by category. */
  labels: Record<string, string>;
}) {
  return (
    <div className="ui-legend">
      {categories.map((category, index) => (
        <div className="ui-legend-item" key={category}>
          <Icon
            fill="currentColor"
            icon={Circle}
            size={10}
            style={{ color: chartColor(index) }}
          />
          <span className="ui-legend-item-content">{labels[category]}</span>
        </div>
      ))}
    </div>
  );
}
