import type { ReactNode } from "react";
import {
  CartesianGrid,
  Dot,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AxisDomain } from "recharts/types/util/types";

import { ChartTooltip } from "./ChartTooltip";
import { textWidth } from "./chartText";
import { useClientValue } from "./clientValue";
import { chartColor, Legend } from "./Legend";

/*
 * A line per category over `data` against a numeric x axis keyed by `index`,
 * under a header row holding the chart's title and the legend of its
 * categories. Series take the chart colors in category
 * order. Recharts elements passed as `children` (reference lines) draw inside
 * the chart after the lines.
 */

interface LineChartProps {
  categories: string[];
  /** Recharts elements drawn inside the chart after the lines. */
  children?: ReactNode;
  /** One row per x value; a category without a value there leaves a gap in its line. */
  data: Partial<Record<string, number>>[];
  height: number;
  index: string;
  /** Formats the x axis ticks; the bare number by default. */
  indexFormatter?: (value: number) => string;
  /** The x values to mark on the axis, in place of evenly spaced ones. */
  indexTicks?: number[];
  /** Display names by category. */
  labels: Record<string, string>;
  title: string;
  /** Formats the hovered x value as the tooltip's title. */
  tooltipLabelFormatter: (label: number) => ReactNode;
  tooltipValueFormatter: (value: number) => string;
  /** Formats the value axis ticks. */
  valueFormatter: (value: number) => string;
  xAxisDomain: AxisDomain;
  yAxisDomain: AxisDomain;
}

/** Room for the hovered dot (radius 5) at the top edge of the plot. */
const DOT_RADIUS = 5;

/**
 * Width of the value axis: the widest formatted value plus 16px. The text is
 * measured in the browser; the server and the first client frame use 16px.
 */
function useValueAxisWidth(
  data: Partial<Record<string, number>>[],
  categories: string[],
  valueFormatter: (value: number) => string,
): number {
  let widest = "";
  for (const row of data) {
    for (const category of categories) {
      const value = row[category];
      if (value === undefined) continue;
      const formatted = valueFormatter(value);
      if (formatted.length > widest.length) widest = formatted;
    }
  }
  return useClientValue(() => textWidth(widest), 0) + 16;
}

export function LineChart({
  categories,
  children,
  data,
  height,
  index,
  indexFormatter,
  indexTicks,
  labels,
  title,
  tooltipLabelFormatter,
  tooltipValueFormatter,
  valueFormatter,
  xAxisDomain,
  yAxisDomain,
}: LineChartProps) {
  const yAxisWidth = useValueAxisWidth(data, categories, valueFormatter);
  // A single point has no line to draw, so it shows as a dot.
  const lone = data.length === 1;

  return (
    <figure className="ui-chart" style={{ height }}>
      <figcaption className="ui-chart-header">
        <span className="ui-chart-title">{title}</span>
        <Legend categories={categories} labels={labels} />
      </figcaption>
      <div className="ui-chart-plot">
        <ResponsiveContainer>
          <RechartsLineChart data={data} margin={{ top: DOT_RADIUS }}>
            <CartesianGrid className="ui-chart-grid-lines" vertical={false} />
            <XAxis
              axisLine={false}
              className="ui-chart-label"
              dataKey={index}
              domain={xAxisDomain}
              interval="equidistantPreserveStart"
              padding={{ left: 20, right: 20 }}
              // Tick labels render in a layer outside the axis group, so they carry the label class themselves.
              tick={{
                className: "ui-chart-label",
                transform: "translate(0, 6)",
              }}
              tickFormatter={indexFormatter}
              tickLine={false}
              ticks={indexTicks}
              type="number"
            />
            <YAxis
              axisLine={false}
              className="ui-chart-label"
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
              type="number"
              width={yAxisWidth}
            />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload ? (
                  <ChartTooltip
                    rows={payload.map((item) => {
                      const category = String(item.dataKey);
                      return {
                        color: chartColor(categories.indexOf(category)),
                        label: labels[category]!,
                        value: tooltipValueFormatter(Number(item.value)),
                      };
                    })}
                    title={tooltipLabelFormatter(Number(label))}
                  />
                ) : null
              }
              cursor={{ stroke: "var(--color-fg-secondary)", strokeWidth: 1 }}
              isAnimationActive={false}
              position={{ y: 0 }}
              wrapperStyle={{ outline: "none" }}
            />
            {categories.map((category, position) => {
              const color = chartColor(position);
              return (
                <Line
                  activeDot={(props) => (
                    <Dot
                      cx={props.cx}
                      cy={props.cy}
                      r={DOT_RADIUS}
                      stroke={props.stroke}
                      strokeWidth={props.strokeWidth}
                      style={{ fill: color }}
                    />
                  )}
                  dataKey={category}
                  dot={
                    lone
                      ? (props) => (
                          <Dot
                            cx={props.cx}
                            cy={props.cy}
                            r={DOT_RADIUS}
                            style={{ fill: color }}
                          />
                        )
                      : false
                  }
                  isAnimationActive={false}
                  key={category}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  style={{ stroke: color }}
                />
              );
            })}
            {children}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
