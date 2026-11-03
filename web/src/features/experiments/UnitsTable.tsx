import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { unitExclusions } from "../../domain/experiments/analysis";
import {
  cellKey,
  observationCells,
  unitDays,
} from "../../domain/experiments/cell-reading";
import {
  observationOrdinals,
  unitIsAvailableAt,
} from "../../domain/experiments/culture-events";
import { placedPhotos } from "../../domain/experiments/photos";
import type {
  ExperimentDetail,
  Unit,
} from "../../domain/experiments/read-model";
import { m } from "../../paraglide/messages";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
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
import { TextLink } from "../../ui/kit/TextLink";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentName } from "./TreatmentName";
import { UnitDayCount } from "./UnitDayCount";
import { UnitSelectionBar } from "./UnitSelectionBar";

/** The experiment's units and their readings, grouped by treatment. */
export function UnitsTable({ data }: { data: ExperimentDetail }) {
  const {
    experiment,
    treatments,
    units,
    observations,
    images,
    manualReadings,
    models,
    datasets,
  } = data;
  useRouteRefresh(
    5000,
    images.some((image) => image.state === "pending"),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [treatment, setTreatment] = useState<string | null>(null);

  const cells = observationCells(images, manualReadings);
  const ordinals = observationOrdinals(observations);
  const placed = placedPhotos(data);
  const treatmentOf = new Map(treatments.map((item) => [item.id, item]));
  // A treatment's units stay together, in the design's order.
  const rows = treatments.flatMap((item) =>
    item.id === treatment || treatment === null
      ? units.filter((unit) => unit.treatment === item.id)
      : [],
  );
  const chosen = rows.filter((unit) => selected.has(unit.id));
  const select = (ids: readonly string[], on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const unitHref = (unit: Unit, observation?: string) => ({
    to: "/experiments/$experiment/$unit" as const,
    params: { experiment: experiment.id, unit: unit.id },
    search: { observation },
  });

  return (
    <>
      <Table
        aria-label={m.experiment_grid_label({
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
              onChange={(value) => {
                setTreatment(value);
                setSelected(new Set());
              }}
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableSelectionHead
              fixed="start"
              checked={rows.length > 0 && chosen.length === rows.length}
              indeterminate={chosen.length > 0 && chosen.length < rows.length}
              disabled={rows.length === 0}
              onChange={(on) =>
                select(
                  rows.map((unit) => unit.id),
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
            {observations.map((observation) => (
              <TableHead key={observation.id} className="min-w-28">
                <ObservationMenu
                  experiment={experiment.id}
                  inoculatedOn={experiment.inoculatedOn}
                  observation={observation}
                  observations={observations}
                  units={units.filter((unit) =>
                    unitIsAvailableAt(unit.events, observation, ordinals),
                  )}
                  images={images.filter(
                    (image) => image.observation === observation.id,
                  )}
                  manualReadings={manualReadings.filter(
                    (reading) => reading.observation === observation.id,
                  )}
                  treatments={treatments}
                  placed={placed}
                  models={models}
                  datasets={datasets
                    .filter(
                      (dataset) => dataset.modelId === observation.modelId,
                    )
                    .map(({ id, name }) => ({ id, name }))}
                />
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {rows.map((unit) => {
            const owner = treatmentOf.get(unit.treatment);
            const exclusion = unitExclusions(
              unit.events,
              unitDays(cells, unit.id, observations),
              ordinals,
              experiment,
            );
            return (
              <TableRow
                key={unit.id}
                data-state={selected.has(unit.id) ? "selected" : undefined}
                clickable
              >
                <TableSelectionCell
                  fixed="start"
                  aria-label={unit.code}
                  checked={selected.has(unit.id)}
                  onChange={(on) => select([unit.id], on)}
                />
                <TableCell fixed="start" cellSlot="title">
                  <TextLink render={<Link {...unitHref(unit)} />}>
                    {unit.code}
                  </TextLink>
                </TableCell>
                <TableCell fixed="start">
                  {owner ? <TreatmentName treatment={owner} /> : null}
                </TableCell>
                {observations.map((observation) => (
                  <TableCell key={observation.id}>
                    <UnitDayCount
                      cell={cells.get(cellKey(unit.id, observation.id))}
                      observation={observation}
                      exclusion={exclusion(observation)}
                      link={(content) => (
                        <TextLink
                          render={<Link {...unitHref(unit, observation.id)} />}
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
      <div className="pointer-events-none sticky bottom-0 flex shrink-0 justify-center *:pointer-events-auto">
        <UnitSelectionBar
          experiment={experiment.id}
          units={chosen}
          treatments={treatments}
          observations={observations}
          onClear={() => setSelected(new Set())}
        />
      </div>
    </>
  );
}
