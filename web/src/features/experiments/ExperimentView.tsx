import { Link } from "@tanstack/react-router";
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";

import { unitExclusions } from "../../domain/experiments/analysis";
import type { Unit } from "../../domain/experiments/contracts";
import {
  observationOrdinals,
  unitIsAvailableAt,
} from "../../domain/experiments/culture-events";
import { placedPhotos } from "../../domain/experiments/photos";
import {
  cellKey,
  observationCells,
  unitDays,
} from "../../domain/experiments/readings";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { experimentSummary } from "../../domain/experiments/summary";
import type { getExperimentGrid } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { formatDay } from "../../ui/Day";
import { Button } from "../../ui/kit/Button";
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
import { Tabs } from "../../ui/kit/Tabs";
import { TextLink } from "../../ui/kit/TextLink";
import { Page } from "../../ui/Page";
import { ExperimentMenu } from "./ExperimentMenu";
import { observationQuestion } from "./labels";
import { RecordObservationDialog } from "./ObservationDialog";
import { ObservationMenu } from "./ObservationMenu";
import { TreatmentSummary } from "./TreatmentSummary";
import { TreatmentName, TreatmentsTable } from "./TreatmentsTable";
import { UnitDayCount } from "./UnitDayCount";
import { UnitSelectionBar } from "./UnitSelectionBar";

/**
 * The parts of an experiment, one on show at a time: its units and what they
 * read, the summary of them by treatment, then its treatments.
 */
export const EXPERIMENT_TABS = ["units", "summary", "treatments"] as const;

export type ExperimentTab = (typeof EXPERIMENT_TABS)[number];

type ExperimentGridData = NonNullable<
  Awaited<ReturnType<typeof getExperimentGrid>>
>;

/**
 * One experiment, in three tabs: its units, a row per unit with the treatment
 * it belongs to and what it read on each day; the summary, each treatment's
 * mean and spread on each day; and its treatments, a row per treatment.
 */
export function ExperimentView({
  data,
  tab,
  onTabChange,
}: {
  data: ExperimentGridData;
  tab: ExperimentTab;
  onTabChange: (tab: ExperimentTab) => void;
}) {
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
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [treatment, setTreatment] = useState<string | null>(null);

  const cells = observationCells(images, manualReadings);
  const ordinals = observationOrdinals(observations);
  const placed = placedPhotos(data);
  const hasRecords =
    images.length > 0 ||
    manualReadings.length > 0 ||
    units.some((unit) => unit.events.length > 0);
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

  // A column is one day; it names its model too when the days read for more
  // than one, and the classes it counts when it counts fewer than its model
  // finds, since values compare within a column and columns may ask
  // different questions.
  const asked = new Set(observations.map((item) => item.modelId));
  const question = (observation: ExperimentObservation) =>
    observationQuestion(
      observation,
      models.find((item) => item.id === observation.modelId),
      { nameModel: asked.size > 1 },
    );

  const unitsTab = (
    <>
      <Table
        aria-label={m.experiment_grid_label({
          experiment: experiment.name,
        })}
        size="small"
        toolbar={
          treatments.length > 1 ? (
            <Select
              aria-label={m.experiment_column_treatment()}
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
              {m.experiment_column_treatment()}
            </TableHead>
            {observations.map((observation) => (
              <TableHead key={observation.id} className="min-w-28">
                <ObservationMenu
                  experiment={experiment.id}
                  inoculatedOn={experiment.inoculatedOn}
                  observation={observation}
                  observations={observations}
                  question={question(observation)}
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

  return (
    <Page
      title={experiment.name}
      icon={FlaskConical}
      meta={[
        experiment.plantMaterial,
        experiment.explantType,
        experiment.baseMedium,
        m.experiment_meta_inoculated({
          day: formatDay(experiment.inoculatedOn),
        }),
      ].filter(Boolean)}
      actions={
        <>
          <Button type="primary" icon={Plus} onClick={() => setRecording(true)}>
            {m.observation_record()}
          </Button>
          <ExperimentMenu experiment={experiment} hasRecords={hasRecords} />
        </>
      }
    >
      <Tabs
        activeKey={tab}
        items={[
          { key: "units", label: m.experiment_units() },
          { key: "summary", label: m.experiment_summary() },
          { key: "treatments", label: m.experiment_treatments() },
        ]}
        onChange={onTabChange}
      />
      {tab === "units" ? (
        unitsTab
      ) : tab === "summary" ? (
        <TreatmentSummary
          treatments={treatments}
          units={units}
          observations={observations}
          summary={experimentSummary(data)}
        />
      ) : (
        <TreatmentsTable
          experiment={experiment.id}
          treatments={treatments}
          units={units}
        />
      )}

      <RecordObservationDialog
        experiment={experiment.id}
        inoculatedOn={experiment.inoculatedOn}
        models={models}
        previous={observations.at(-1)}
        observations={observations}
        units={units}
        placed={placed}
        open={recording}
        onClose={() => setRecording(false)}
      />
    </Page>
  );
}
