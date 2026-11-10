import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { analysisFrame, baselineDays } from "../../domain/experiments/analysis";
import type {
  ExperimentFrame,
  SheetRow,
  Unit,
  UnitPage,
} from "../../domain/experiments/read-model";
import { UNIT_PAGE_SIZES } from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { useDialog } from "../../ui/hooks/useDialog";
import { Button } from "../../ui/kit/Button";
import { Pagination, paginates } from "../../ui/kit/Pagination";
import { Select } from "../../ui/kit/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectionCell,
  TableSelectionHead,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentName } from "./TreatmentName";
import { UnitBaselineValue } from "./UnitBaseline";
import { UnitBaselineDialog } from "./UnitBaselineDialog";
import { UnitDayCount } from "./UnitDayCount";
import { UnitSelectionBar } from "./UnitSelectionBar";
import type { UnitChoice } from "./unit-choice";

/** Where the units' table goes next: another page, page size or treatment. */
interface UnitPageChange {
  page?: number;
  size?: number;
  treatment?: string;
}

/**
 * A page of the experiment's units and their readings, grouped by treatment,
 * each row as the server resolved it. Ticking selects units on the page;
 * once the whole page is ticked, every unit the page is drawn from can be
 * selected at once, and commands then reach units on other pages too.
 */
export function UnitsTable({
  frame,
  models,
  units,
  onPage,
}: {
  frame: ExperimentFrame;
  models: readonly Model[];
  units: UnitPage;
  onPage: (change: UnitPageChange) => void;
}) {
  const { experiment, treatments, observations } = frame;
  const { treatment, rows } = units;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Every unit the page is drawn from, chosen as they numbered then; should
  // their number change, the command made of the choice is refused.
  const [every, setEvery] = useState<number | null>(null);
  // The row whose baseline is being named, as it stood when the dialog opened.
  const baselineDialog = useDialog<{ row: SheetRow }>();
  const treatmentOf = new Map(treatments.map((item) => [item.id, item]));
  const onPageTicked = rows.filter((row) => ticked.has(row.unit.id));
  const wholePage = rows.length > 0 && onPageTicked.length === rows.length;
  const choice: UnitChoice =
    every === null
      ? { units: onPageTicked.map((row) => row.unit) }
      : { treatment, count: every };
  const tick = (ids: readonly string[], on: boolean) => {
    setEvery(null);
    setTicked((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const clear = () => {
    setEvery(null);
    setTicked(new Set());
  };
  // A unit opens on the workbench stepping through the units the table is
  // narrowed to, and knows the size of its pages to come back to.
  const unitLink = (unit: Unit, observation?: string) => ({
    to: "/experiments/$experiment/$unit" as const,
    params: { experiment: experiment.id, unit: unit.id },
    search: {
      observation,
      treatment: treatment ?? undefined,
      size: units.pageSize,
    },
  });

  return (
    <>
      <Table
        aria-label={m.experiment_units_table_label({
          experiment: experiment.name,
        })}
        size="small"
        toolbar={
          treatments.length > 1 ? (
            <Select
              aria-label={m.treatment_label()}
              allowClear
              className="w-48"
              options={treatments.map((item) => ({
                value: item.id,
                label: <TreatmentName treatment={item} />,
              }))}
              placeholder={m.experiment_units_all_treatments()}
              size="small"
              value={treatment}
              onChange={(value) =>
                onPage({ treatment: value ?? undefined, page: 1 })
              }
            />
          ) : undefined
        }
        footer={
          paginates({ ...units, pageSizes: UNIT_PAGE_SIZES }) ? (
            <Pagination
              current={units.page}
              pageSize={units.pageSize}
              total={units.total}
              pageSizes={UNIT_PAGE_SIZES}
              onChange={(page) => onPage({ page })}
              onPageSizeChange={(size) => onPage({ size, page: 1 })}
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableSelectionHead
              fixed="start"
              checked={every !== null || wholePage}
              indeterminate={
                every === null && onPageTicked.length > 0 && !wholePage
              }
              disabled={rows.length === 0}
              onChange={(on) =>
                tick(
                  rows.map((row) => row.unit.id),
                  on,
                )
              }
            />
            <TableHead fixed="start" className="min-w-24">
              {m.experiment_column_unit()}
            </TableHead>
            <TableHead fixed="start" className="min-w-36">
              {m.treatment_label()}
            </TableHead>
            <TableHead className="min-w-24">
              {m.unit_baseline_column()}
            </TableHead>
            {observations.map((observation) => (
              <TableHead key={observation.id} className="min-w-28">
                <ObservationMenu
                  experiment={experiment.id}
                  inoculatedOn={experiment.inoculatedOn}
                  observation={observation}
                  observations={observations}
                  treatments={treatments}
                  treatment={treatment}
                  models={models}
                />
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {every !== null || (wholePage && units.total > rows.length) ? (
            <tr>
              <td colSpan={observations.length + 4}>
                <EveryUnitNotice
                  pageUnits={rows.length}
                  every={every}
                  total={units.total}
                  onEveryUnit={() => setEvery(units.total)}
                  onClear={clear}
                />
              </td>
            </tr>
          ) : null}
          {rows.map((row) => {
            const { unit, cells } = row;
            const baseline = (
              <UnitBaselineValue
                baseline={row.baseline}
                observations={observations}
              />
            );
            const owner = treatmentOf.get(unit.treatment);
            const selected = every !== null || ticked.has(unit.id);
            return (
              <TableRow
                key={unit.id}
                data-state={selected ? "selected" : undefined}
                clickable
              >
                <TableSelectionCell
                  fixed="start"
                  aria-label={unit.code}
                  checked={selected}
                  onChange={(on) => tick([unit.id], on)}
                />
                <TableCell fixed="start" cellSlot="title">
                  <TextLink render={<Link {...unitLink(unit)} />}>
                    {unit.code}
                  </TextLink>
                </TableCell>
                <TableCell fixed="start">
                  {owner ? <TreatmentName treatment={owner} /> : null}
                </TableCell>
                <TableCell>
                  {observations.length > 1 ? (
                    <TextLink
                      render={
                        <button
                          type="button"
                          onClick={() => baselineDialog.show("row", row)}
                        />
                      }
                    >
                      {baseline}
                    </TextLink>
                  ) : (
                    baseline
                  )}
                </TableCell>
                {cells.map((cell) => (
                  <TableCell key={cell.observation}>
                    <UnitDayCount
                      cell={cell}
                      link={(content) => (
                        <TextLink
                          render={
                            <Link {...unitLink(unit, cell.observation)} />
                          }
                        >
                          {content}
                        </TextLink>
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {baselineDialog.last ? (
        <UnitBaselineDialog
          experiment={experiment.id}
          choice={{ units: [baselineDialog.last.value.unit] }}
          observations={observations}
          days={rowBaselineDays(baselineDialog.last.value, frame)}
          open={baselineDialog.open}
          onClose={baselineDialog.close}
          onDone={baselineDialog.close}
        />
      ) : null}
      <div className="pointer-events-none sticky bottom-0 flex shrink-0 justify-center *:pointer-events-auto">
        <UnitSelectionBar
          experiment={experiment.id}
          choice={choice}
          treatments={treatments}
          observations={observations}
          onClear={clear}
        />
      </div>
    </>
  );
}

/** What a row's unit would take its rates over on each observation, read from the row's own evidence. */
function rowBaselineDays(
  { unit, cells }: SheetRow,
  { experiment, observations }: ExperimentFrame,
) {
  return baselineDays(
    unit.events,
    observations.map((observation, index) => ({
      observation,
      image: cells[index]!.image,
      manual: cells[index]!.manual,
    })),
    analysisFrame(experiment, observations),
  );
}

/**
 * Over a page ticked whole, the offer to reach every unit the page is drawn
 * from, or, once taken, how many it reached and the way back.
 */
function EveryUnitNotice({
  pageUnits,
  every,
  total,
  onEveryUnit,
  onClear,
}: {
  /** How many units the page holds, every one of them ticked. */
  pageUnits: number;
  /** How many units were chosen with every unit, or null before. */
  every: number | null;
  total: number;
  onEveryUnit: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky start-0 flex w-max items-center gap-2 px-2 py-1.5">
      <Text as="span" size="sm" type="secondary">
        {every === null
          ? m.experiment_selection_count({ count: pageUnits })
          : m.experiment_selection_all({ count: every })}
      </Text>
      <Button
        type="text"
        size="small"
        onClick={every === null ? onEveryUnit : onClear}
      >
        {every === null
          ? m.experiment_select_all_units({ count: total })
          : m.experiment_selection_clear()}
      </Button>
    </div>
  );
}
