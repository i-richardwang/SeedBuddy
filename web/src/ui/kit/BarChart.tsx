import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ErrorBar,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AxisDomain } from "recharts/types/util/types";

import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import { fitText } from "./chartText";

/*
 * One bar per item, each in its own color, with an error bar reaching one
 * `spread` above and below its value, under a header row holding the chart's
 * title and whatever control chooses what is charted. An item without a
 * value leaves its slot empty. It sits in the frame the charts share
 * (`Chart.css`).
 */

export interface BarChartItem {
  key: string;
  /** Under the bar, on the category axis. */
  label: string;
  /** Any CSS color, a chart color token included. */
  color: string;
  value: number | null;
  /** How far the error bar reaches each way, or none. */
  spread: number | null;
}

export interface BarChartTooltip {
  title: ReactNode;
  rows: ChartTooltipRow[];
}

export interface BarChartProps {
  /** A control over the chart, beside its title. */
  extra?: ReactNode;
  height: number;
  items: BarChartItem[];
  title: string;
  /** What the tooltip over an item's bar says, or nothing for no tooltip. */
  tooltip: (item: BarChartItem) => BarChartTooltip | null;
  /** Formats the value axis ticks. */
  valueFormatter: (value: number) => string;
  /** The values to mark on the axis, in place of evenly spaced ones. */
  valueTicks?: number[];
  yAxisDomain: AxisDomain;
}

const VALUE_AXIS_WIDTH = 48;
/** Air on each side of a category label within its slot. */
const LABEL_GUTTER = 4;
/** Room above the tallest error bar. */
const PLOT_MARGIN = 8;
const MAX_BAR_SIZE = 48;

/**
 * A category's label under its bar, cut to its slot of the axis so neighbours
 * never overlap; the whole label is in its `title`.
 */
function CategoryTick({
  label,
  slot,
  x,
  y,
}: {
  label: string;
  slot: number;
  x: number;
  y: number;
}) {
  const shown = fitText(label, slot - LABEL_GUTTER * 2);
  if (!shown) return null;
  return (
    <text className="ui-chart-label" dy={16} textAnchor="middle" x={x} y={y}>
      <title>{label}</title>
      {shown}
    </text>
  );
}

export function BarChart({
  extra,
  height,
  items,
  title,
  tooltip,
  valueFormatter,
  valueTicks,
  yAxisDomain,
}: BarChartProps) {
  return (
    <figure className="ui-chart" style={{ height }}>
      <figcaption className="ui-chart-header">
        <span className="ui-chart-title">{title}</span>
        {extra}
      </figcaption>
      <div className="ui-chart-plot">
        <ResponsiveContainer>
          <RechartsBarChart data={items} margin={{ top: PLOT_MARGIN }}>
            <CartesianGrid className="ui-chart-grid-lines" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              interval={0}
              tick={(props) => (
                <CategoryTick
                  label={String(props.payload.value)}
                  slot={Number(props.width) / props.visibleTicksCount}
                  x={Number(props.x)}
                  y={Number(props.y)}
                />
              )}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={yAxisDomain}
              tick={(props) => (
                <text
                  className="ui-chart-label"
                  dy={4}
                  textAnchor="start"
                  x={0}
                  y={Number(props.y)}
                >
                  {valueFormatter(props.payload.value)}
                </text>
              )}
              tickLine={false}
              ticks={valueTicks}
              type="number"
              width={VALUE_AXIS_WIDTH}
            />
            <Tooltip
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as BarChartItem | undefined;
                const content = active && item ? tooltip(item) : null;
                return content ? (
                  <ChartTooltip title={content.title} rows={content.rows} />
                ) : null;
              }}
              cursor={{ fill: "var(--color-fill-tertiary)" }}
              isAnimationActive={false}
              wrapperStyle={{ outline: "none" }}
            />
            <Bar
              dataKey="value"
              isAnimationActive={false}
              maxBarSize={MAX_BAR_SIZE}
              radius={[2, 2, 0, 0]}
            >
              {items.map((item) => (
                <Cell key={item.key} fill={item.color} />
              ))}
              <ErrorBar
                dataKey="spread"
                direction="y"
                stroke="var(--color-fg-secondary)"
                strokeWidth={1}
                width={6}
              />
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
