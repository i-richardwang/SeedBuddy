import type { ReactNode } from "react";
import { ReferenceLine } from "recharts";

import type { TrainingEpoch } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";
import { LineChart } from "../../ui/kit/LineChart";
import { Skeleton } from "../../ui/kit/Skeleton";
import { Text } from "../../ui/kit/Text";
import { formatDecimal } from "../../ui/numbers";

interface Series {
  key: string;
  label: () => string;
  value: (epoch: TrainingEpoch) => number;
}

interface Chart {
  key: string;
  title: () => string;
  series: Series[];
  /** Metrics live in [0, 1]; losses take whatever range the run produces. */
  unit?: boolean;
}

function losses(split: "train" | "val"): Series[] {
  const components = [
    ["box", m.epoch_series_box_loss],
    ["classification", m.epoch_series_classification_loss],
    ["regression", m.epoch_series_regression_loss],
  ] as const;
  return components.map(([component, label]) => ({
    key: `${split}-${component}`,
    label,
    value: (epoch) => epoch[split][component],
  }));
}

const CHARTS: Chart[] = [
  { key: "train", title: m.epoch_chart_train_loss, series: losses("train") },
  { key: "val", title: m.epoch_chart_val_loss, series: losses("val") },
  {
    key: "map",
    title: m.epoch_chart_map,
    unit: true,
    series: [
      {
        key: "map50",
        label: m.epoch_series_map50,
        value: (epoch) => epoch.map50,
      },
      {
        key: "map50To95",
        label: m.epoch_series_map50_95,
        value: (epoch) => epoch.map50To95,
      },
    ],
  },
  {
    key: "precision-recall",
    title: m.epoch_chart_precision_recall,
    unit: true,
    series: [
      {
        key: "precision",
        label: m.epoch_series_precision,
        value: (epoch) => epoch.precision,
      },
      {
        key: "recall",
        label: m.epoch_series_recall,
        value: (epoch) => epoch.recall,
      },
    ],
  },
];

const CHART_HEIGHT = 300;

/**
 * Four titled charts of per-epoch curves, two abreast on a wide screen; a
 * dashed line marks the best epoch.
 */
export function EpochCharts({
  epochs,
  total,
  best,
}: {
  epochs: TrainingEpoch[];
  total: number;
  best: TrainingEpoch | null;
}) {
  return (
    <div className="grid gap-x-8 gap-y-6 laptop:grid-cols-2">
      {CHARTS.map((chart) => (
        <EpochChart
          key={chart.key}
          chart={chart}
          epochs={epochs}
          total={total}
          best={best}
        />
      ))}
    </div>
  );
}

/** `EpochCharts` while the run loads: the four titles, each over a bone the chart's height. */
export function EpochChartsSkeleton() {
  return (
    <div aria-hidden className="grid gap-x-8 gap-y-6 laptop:grid-cols-2">
      {CHARTS.map((chart) => (
        <ChartFigure key={chart.key} title={chart.title()}>
          <Skeleton height={CHART_HEIGHT} />
        </ChartFigure>
      ))}
    </div>
  );
}

/** A chart's title over the bone that holds its place. */
function ChartFigure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <Text as="figcaption" size="xs" type="secondary" weight="medium">
        {title}
      </Text>
      {children}
    </figure>
  );
}

function EpochChart({
  chart,
  epochs,
  total,
  best,
}: {
  chart: Chart;
  epochs: TrainingEpoch[];
  total: number;
  best: TrainingEpoch | null;
}) {
  const data = epochs.map((epoch) => ({
    epoch: epoch.epoch,
    ...Object.fromEntries(
      chart.series.map((series) => [series.key, series.value(epoch)]),
    ),
  }));
  const categories = chart.series.map((series) => series.key);
  const names = Object.fromEntries(
    chart.series.map((series) => [series.key, series.label()]),
  );

  return (
    <LineChart
      title={chart.title()}
      data={data}
      index="epoch"
      categories={categories}
      labels={names}
      height={CHART_HEIGHT}
      xAxisDomain={[1, Math.max(total, 2)]}
      yAxisDomain={chart.unit ? [0, 1] : ["auto", "auto"]}
      valueFormatter={(value) => formatDecimal(value, 2)}
      tooltipLabelFormatter={(epoch) => m.epoch_label({ epoch })}
      tooltipValueFormatter={(value) => formatDecimal(value, 4)}
    >
      {best && (
        <ReferenceLine
          x={best.epoch}
          stroke="var(--color-fg-quaternary)"
          strokeDasharray="4 3"
        />
      )}
    </LineChart>
  );
}
