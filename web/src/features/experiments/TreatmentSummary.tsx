import { useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import {
  type ExperimentSummary,
  type Statistic,
  type SummaryMeasure,
  summaryCell,
  summaryMeasure,
  type TreatmentDaySummary,
} from "../../domain/experiments/summary";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { formatDay } from "../../ui/Day";
import { BarChart, type BarChartItem } from "../../ui/kit/BarChart";
import { Card } from "../../ui/kit/Card";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import { chartColor } from "../../ui/kit/Legend";
import { Select } from "../../ui/kit/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { Tooltip } from "../../ui/kit/Tooltip";
import {
  formatCount,
  formatDecimal,
  formatPercent,
  formatRate,
} from "../../ui/numbers";
import { observationLabel, summaryMeasureLabel } from "./labels";
import { TreatmentName } from "./TreatmentsTable";

/**
 * The experiment by treatment: a chart of one day's means with their
 * standard deviations as error bars, on a card over a table of every day. The
 * table groups two columns under each day, the treatment's mean ± SD over its
 * units in the analysis and how many there were. A day is read by its rate,
 * each unit's count over its own count on the first observation, where it
 * has one, and by its count otherwise; the first observation always by its
 * count. The rate's definition shows on its column head.
 */
export function TreatmentSummary({
  treatments,
  units,
  observations,
  summary,
}: {
  treatments: readonly Treatment[];
  units: readonly Unit[];
  observations: readonly ExperimentObservation[];
  summary: ExperimentSummary;
}) {
  const last = observations.at(-1);
  const [chosen, setChosen] = useState(last?.id ?? null);
  const inView =
    observations.find((observation) => observation.id === chosen) ?? last;
  const baseline = observations.find(
    (observation) => observation.id === summary.baseline,
  );
  const hasNumbers = summary.cells.some((cell) => cell.count !== null);
  if (!inView || !hasNumbers) {
    return (
      <EmptyPlace variant="outlined">
        <Empty
          title={m.summary_empty()}
          description={m.summary_empty_description()}
        />
      </EmptyPlace>
    );
  }
  const cellOf = (treatment: Treatment, observation: ExperimentObservation) =>
    summaryCell(summary, treatment.id, observation.id);
  const measureOf = (observation: ExperimentObservation) =>
    summaryMeasure(summary, observation.id);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SummaryChart
          treatments={treatments}
          units={units}
          observations={observations}
          inView={inView}
          measure={measureOf(inView)}
          cells={treatments.map((treatment) => cellOf(treatment, inView))}
          onChange={setChosen}
        />
      </Card>
      <Table aria-label={m.experiment_summary()} size="small">
        <TableHeader>
          <tr>
            <TableHead fixed="start" rowSpan={2} className="min-w-36">
              {m.experiment_column_treatment()}
            </TableHead>
            {observations.map((observation) => (
              <TableHead key={observation.id} colSpan={2}>
                {observationLabel(observation)}
              </TableHead>
            ))}
          </tr>
          <tr>
            {observations.map((observation) => (
              <MeasureHeads
                key={observation.id}
                measure={measureOf(observation)}
                baseline={baseline}
              />
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {treatments.map((treatment) => (
            <TableRow key={treatment.id}>
              <TableCell fixed="start" cellSlot="title">
                <TreatmentName treatment={treatment} />
              </TableCell>
              {observations.map((observation) => (
                <SummaryCells
                  key={observation.id}
                  statistic={statisticOf(
                    cellOf(treatment, observation),
                    measureOf(observation),
                  )}
                  measure={measureOf(observation)}
                />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The two heads under a day: what the day is measured by, the rate's
 * definition on hover, and n.
 */
function MeasureHeads({
  measure,
  baseline,
}: {
  measure: SummaryMeasure;
  baseline: ExperimentObservation | undefined;
}) {
  const label = <span>{summaryMeasureLabel(measure)}</span>;
  return (
    <>
      <TableHead numeric className="min-w-28">
        {measure === "rate" && baseline ? (
          <Tooltip
            title={m.summary_note_rate({ day: formatDay(baseline.observedOn) })}
          >
            {label}
          </Tooltip>
        ) : (
          label
        )}
      </TableHead>
      <TableHead numeric className="w-16">
        {m.summary_column_n()}
      </TableHead>
    </>
  );
}

function statisticOf(
  cell: TreatmentDaySummary | undefined,
  measure: SummaryMeasure,
): Statistic | null {
  if (!cell) return null;
  return measure === "rate" ? cell.rate : cell.count;
}

function formatMeasure(value: number, measure: SummaryMeasure): string {
  return measure === "rate" ? formatRate(value) : formatDecimal(value, 1);
}

/** A statistic as a line: the mean, with its spread when more than one unit gave it. */
function formatStatistic(statistic: Statistic, measure: SummaryMeasure) {
  const mean = formatMeasure(statistic.mean, measure);
  return statistic.sd === null
    ? mean
    : m.summary_mean_sd({ mean, sd: formatMeasure(statistic.sd, measure) });
}

/** A day's two cells for a treatment: mean ± SD and n, or absent where no unit gave a number. */
function SummaryCells({
  statistic,
  measure,
}: {
  statistic: Statistic | null;
  measure: SummaryMeasure;
}) {
  return (
    <>
      <TableCell numeric>
        {statistic ? formatStatistic(statistic, measure) : <Absent />}
      </TableCell>
      <TableCell numeric>
        {statistic ? formatCount(statistic.n) : <Absent />}
      </TableCell>
    </>
  );
}

const CHART_HEIGHT = 280;
/** A rate's axis is marked by quarters. */
const RATE_TICK = 0.25;

/**
 * One day's means by treatment, each bar in its treatment's color with an
 * error bar of one standard deviation; the day is chosen over the chart.
 */
function SummaryChart({
  treatments,
  units,
  observations,
  inView,
  measure,
  cells,
  onChange,
}: {
  treatments: readonly Treatment[];
  units: readonly Unit[];
  observations: readonly ExperimentObservation[];
  inView: ExperimentObservation;
  measure: SummaryMeasure;
  cells: readonly (TreatmentDaySummary | undefined)[];
  onChange: (observation: string) => void;
}) {
  const codes = new Map(units.map((unit) => [unit.id, unit.code]));
  const statistics = new Map(
    treatments.map((treatment, index) => [
      treatment.id,
      { cell: cells[index], statistic: statisticOf(cells[index], measure) },
    ]),
  );
  const items: BarChartItem[] = treatments.map((treatment) => {
    const statistic = statistics.get(treatment.id)?.statistic ?? null;
    return {
      key: treatment.id,
      label: treatment.name,
      color: chartColor(treatment.position - 1),
      value: statistic?.mean ?? null,
      spread: statistic?.sd ?? null,
    };
  });
  const reach = Math.max(
    0,
    ...items.map((item) => (item.value ?? 0) + (item.spread ?? 0)),
  );
  // A rate's axis is marked by quarters up to the whole, and past it only as
  // far as an error bar reaches.
  const rateTop = Math.max(1, Math.ceil(reach / RATE_TICK) * RATE_TICK);
  const ticks =
    measure === "rate"
      ? Array.from(
          { length: Math.round(rateTop / RATE_TICK) + 1 },
          (_, index) => index * RATE_TICK,
        )
      : undefined;

  return (
    <BarChart
      title={m.summary_chart_title({ measure: summaryMeasureLabel(measure) })}
      extra={
        <Select
          aria-label={m.summary_chart_day()}
          size="small"
          className="w-40"
          options={observations.map((observation) => ({
            value: observation.id,
            label: observationLabel(observation),
          }))}
          value={inView.id}
          onChange={onChange}
        />
      }
      height={CHART_HEIGHT}
      items={items}
      valueFormatter={(value) =>
        measure === "rate" ? formatPercent(value) : formatCount(value)
      }
      valueTicks={ticks}
      yAxisDomain={[0, measure === "rate" ? rateTop : "auto"]}
      tooltip={(item) => {
        const found = statistics.get(item.key);
        if (!found?.statistic || !found.cell) return null;
        const { statistic, cell } = found;
        return {
          title: (
            <span className="flex items-center justify-between gap-4">
              <span>{item.label}</span>
              <Text as="span" type="tertiary" weight="regular">
                {m.summary_n({ count: statistic.n })}
              </Text>
            </span>
          ),
          rows: [
            {
              color: item.color,
              label: m.summary_tooltip_mean(),
              value: formatStatistic(statistic, measure),
            },
            ...cell.units.flatMap((unit) => {
              const value = measure === "rate" ? unit.rate : unit.count;
              return value === null
                ? []
                : [
                    {
                      color: item.color,
                      label: codes.get(unit.unit) ?? unit.unit,
                      value: formatMeasure(value, measure),
                    },
                  ];
            }),
          ],
        };
      }}
    />
  );
}
