import { Link, linkOptions } from "@tanstack/react-router";
import { Columns2, ImageOff } from "lucide-react";
import { useCallback, useEffect, useEffectEvent } from "react";

import type { ReviewSource } from "../../domain/annotation/schema";
import type { NamedDataset } from "../../domain/datasets/schema";
import {
  analysisFrame,
  baselineDays,
  unitAnalysis,
} from "../../domain/experiments/analysis";
import {
  cellReading,
  imageReview,
} from "../../domain/experiments/cell-reading";
import type {
  ReviewState,
  UnitDetail,
  UnitNavigationEntry,
  UnitPageRequest,
} from "../../domain/experiments/read-model";
import type { ObservationImageRef } from "../../domain/experiments/schema";
import { createImageAnalysisRetry } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { useStep } from "../../ui/hooks/useStep";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import {
  Descriptions,
  DescriptionsItem,
  DescriptionsSkeleton,
} from "../../ui/kit/Descriptions";
import { Skeleton } from "../../ui/kit/Skeleton";
import { StatusDot } from "../../ui/kit/Status";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { Stepper } from "../../ui/Stepper";
import { ShellActions } from "../../ui/shell/Shell";
import {
  Workbench,
  WorkbenchEmpty,
  WorkbenchFooter,
  WorkbenchInspector,
  WorkbenchSection,
  WorkbenchSectionSkeleton,
  WorkbenchSkeleton,
} from "../../ui/shell/Workbench";
import {
  ImageSubject,
  ImageWorkbenchSkeleton,
} from "../annotation/ImageWorkbench";
import { useWorkbenchKeys } from "../annotation/keys";
import { CultureMenu } from "./CultureMenu";
import {
  DayComparison,
  DayComparisonSkeleton,
  DayCountsSection,
  referenceDay,
} from "./DayComparison";
import { imageReviewLabel, imageReviewTone, observationLabel } from "./labels";
import { TreatmentName } from "./TreatmentName";
import { UnitBaselineValue } from "./UnitBaseline";
import { UnitMenu } from "./UnitMenu";

/**
 * One unit's photograph on one observation day. The footer steps two ways:
 * through the units on the same day, the way a day's photographs are
 * reviewed, and through the days of the same unit, the way a dish is
 * followed over time. Confirming a review moves on to the next unit
 * still to review that day. The frame and its footer stay through every
 * step; only what they hold is replaced.
 *
 * With `compare`, the day in view stands beside another day of the same
 * unit instead of under its boxes, the other day on the left: the two
 * photographs zoom and pan as one, so a change in the dish is read in place.
 * Each side names and chooses its own day, in place of the footer's days,
 * and the inspector leads with what both days read; steps keep both.
 */
export function UnitWorkbench({
  series,
  datasets,
  table,
  show,
  onShowChange,
  compare,
  onCompareChange,
}: {
  series: UnitDetail;
  datasets: NamedDataset[];
  /** The page of the experiment's units table that holds the unit. */
  table: UnitPageRequest;
  show?: ReviewSource;
  onShowChange: (source: ReviewSource | undefined) => void;
  /** The day the day in view stands beside, if any. */
  compare?: string;
  /** Sets the day to stand beside the day in view; none returns to one day. */
  onCompareChange: (observation: string | undefined) => void;
}) {
  const { experiment, unit, treatments, navigation, shown } = series;

  useRouteRefresh(
    5000,
    shown !== null &&
      ((shown.review.detection === null && shown.failure === null) ||
        shown.review.progress !== null),
  );

  const treatment = treatments.find((item) => item.id === unit.treatment)!;
  const title = m.unit_title({
    code: unit.code,
    experiment: experiment.name,
  });
  const observations = series.observations.map((item) => item.observation);
  const frame = analysisFrame(experiment, observations);
  const analysis = unitAnalysis(unit, series.observations, frame);
  const facts = (
    <>
      <DescriptionsItem label={m.treatment_label()}>
        <TreatmentName treatment={treatment} />
      </DescriptionsItem>
      <DescriptionsItem label={m.unit_baseline()}>
        <UnitBaselineValue
          baseline={analysis.baseline}
          observations={observations}
        />
      </DescriptionsItem>
    </>
  );

  const photographed = series.observations.filter((item) => item.image);
  // Only the days the unit has a record of, a photograph or a count, are
  // chosen or stepped to. A step along the units can still land on a day
  // this one has none of; that day stays among them while it is in view.
  // The day set beside it never is, so a step does not bring a day beside
  // itself.
  const days = series.observations.filter(
    (item) =>
      (item.image ||
        item.manual ||
        item.observation.id === series.observation) &&
      item.observation.id !== compare,
  );
  const reference = series.observations.find(
    (item) => item.observation.id === compare,
  );

  const picturesOf = useCallback(
    (loaderData: unknown) => framedPictures(loaderData, compare),
    [compare],
  );
  const { pending, step, warm } = useStep(picturesOf);
  // A step keeps the day in view and the day beside it; the route keeps
  // the rest of where the unit was opened from.
  const unitTarget = (target: UnitNavigationEntry | null) =>
    target
      ? linkOptions({
          to: "/experiments/$experiment/$unit",
          params: { experiment: experiment.id, unit: target.id },
          search: {
            observation: series.observation ?? undefined,
            compare,
          },
        })
      : undefined;
  const dayAt = days.findIndex(
    (item) => item.observation.id === series.observation,
  );
  const dayTarget = (observation: string | undefined) =>
    observation === undefined
      ? undefined
      : linkOptions({
          to: "/experiments/$experiment/$unit",
          params: { experiment: experiment.id, unit: unit.id },
          search: { observation, compare },
        });
  const neighbors = [
    unitTarget(navigation.previous),
    unitTarget(navigation.next),
    dayTarget(days[dayAt - 1]?.observation.id),
    dayTarget(days[dayAt + 1]?.observation.id),
  ];
  // The four subjects an arrow key leads to are fetched while this one is read.
  const warmNeighbors = useEffectEvent(() => {
    for (const target of neighbors) if (target) void warm(target);
  });
  useEffect(() => warmNeighbors(), [unit.id, series.observation]);
  const toward = (target: (typeof neighbors)[number]) =>
    target ? () => step(target) : undefined;
  const toUnit = (target: UnitNavigationEntry | null) =>
    toward(unitTarget(target));
  const toDay = (observation: string | undefined) =>
    toward(dayTarget(observation));
  const previousUnit = toUnit(navigation.previous);
  const nextUnit = toUnit(navigation.next);
  const toggleCompare =
    reference || photographed.length > 1
      ? () =>
          onCompareChange(
            reference
              ? undefined
              : referenceDay(series.observations, series.observation),
          )
      : undefined;
  useWorkbenchKeys({
    ArrowLeft: previousUnit,
    ArrowRight: nextUnit,
    ArrowUp: toDay(days[dayAt - 1]?.observation.id),
    ArrowDown: toDay(days[dayAt + 1]?.observation.id),
    c: toggleCompare,
  });

  const menu = (
    <UnitMenu
      experiment={experiment.id}
      unit={unit}
      treatments={treatments}
      observations={observations}
      baselineDays={baselineDays(unit.events, series.observations, frame)}
      canRemove={series.removable}
      image={shown}
      datasets={datasets}
      table={table}
    />
  );
  const steps = (
    <WorkbenchFooter label={m.unit_steps()}>
      <Stepper
        previous={{ label: m.unit_previous(), onClick: previousUnit }}
        next={{ label: m.unit_next(), onClick: nextUnit }}
      >
        {m.ui_step_position({
          index: navigation.position,
          total: navigation.total,
        })}
      </Stepper>
      {navigation.toReview > 0 ? (
        <Text as="span" size="sm" type="tertiary" className="whitespace-nowrap">
          {m.unit_unreviewed_count({ count: navigation.toReview })}
        </Text>
      ) : null}
      <span className="flex-1" />
      {reference ? null : days.length === 1 ? (
        <Text
          as="span"
          size="sm"
          type="secondary"
          className="whitespace-nowrap"
        >
          {observationLabel(days[0].observation)}
        </Text>
      ) : days.length > 1 ? (
        <ToggleGroup
          aria-label={m.observation_list_label()}
          value={series.observation ?? undefined}
          options={days.map(({ observation, image }) => ({
            value: observation.id,
            label: observationLabel(observation),
            // Keyed by unit: another unit's standing is not this one's changing.
            mark: image ? (
              <ReviewDot key={unit.id} review={imageReview(image)} />
            ) : undefined,
          }))}
          onChange={(observation) => void toDay(observation)?.()}
        />
      ) : null}
      {toggleCompare ? (
        <ActionIcon
          icon={Columns2}
          size="small"
          title={m.unit_compare()}
          tooltipProps={{ hotkey: "c" }}
          pressed={reference !== undefined}
          onClick={toggleCompare}
        />
      ) : null}
    </WorkbenchFooter>
  );
  const culture = (
    <WorkbenchSection title={m.unit_culture_status()}>
      <div className="flex">
        <CultureMenu
          experiment={experiment.id}
          unit={unit}
          observations={observations}
        />
      </div>
    </WorkbenchSection>
  );

  const inView = series.observations.find(
    (item) => item.observation.id === series.observation,
  );
  if (reference) {
    return (
      <Workbench title={title}>
        {steps}
        <ShellActions>{menu}</ShellActions>
        <WorkbenchInspector>
          <DayCountsSection
            reference={reference}
            inView={inView}
            analysis={(day) => analysis.days[series.observations.indexOf(day)]!}
          />
          {culture}
          <WorkbenchSection title={m.details_label()}>
            <Descriptions>{facts}</Descriptions>
          </WorkbenchSection>
        </WorkbenchInspector>
        <DayComparison
          // Another unit is another dish: its view starts afresh.
          key={unit.id}
          reference={reference}
          inView={inView}
          observations={series.observations}
          pending={pending}
          onReferenceChange={onCompareChange}
          onInViewChange={(observation) => void toDay(observation)?.()}
        />
      </Workbench>
    );
  }

  // In-workbench panels own their empty states and retain the surrounding navigation.
  if (!shown) {
    // A day in view is one this unit was not photographed on, though a
    // person may have counted it; without one, it has not been photographed
    // at all.
    const counted = inView ? cellReading(inView, inView.observation) : null;
    const missing = series.observation
      ? {
          title: m.unit_no_image_on_day(),
          description: counted
            ? m.unit_counted_on_day({ count: counted.count })
            : m.unit_no_image_on_day_description(),
        }
      : {
          title: m.unit_no_image(),
          description: m.unit_no_image_description(),
        };
    return (
      <Workbench title={title}>
        {steps}
        <ShellActions>{menu}</ShellActions>
        <WorkbenchEmpty
          icon={ImageOff}
          title={missing.title}
          description={missing.description}
          action={
            <Button
              render={
                <Link
                  to="/experiments/$experiment"
                  params={{ experiment: experiment.id }}
                />
              }
            >
              {m.unit_open_experiment()}
            </Button>
          }
        />
      </Workbench>
    );
  }

  return (
    <Workbench title={title}>
      {steps}
      <ImageSubject
        key={`${shown.model.id}:${shown.review.ref.digest}`}
        model={shown.model}
        review={shown.review}
        unclear={shown.unclear}
        show={show}
        onShowChange={onShowChange}
        onNext={toUnit(navigation.nextToReview)}
        stepping={pending}
        context={{
          menu,
          counted: shown.observation.countedClasses,
          alert: shown.failure ? (
            <Alert
              type="error"
              title={m.unit_detection_failed()}
              detail={shown.failure.error}
              action={<RetryButton image={shown.ref} />}
            />
          ) : undefined,
          sections: culture,
          facts,
        }}
      />
    </Workbench>
  );
}

/** A `UnitWorkbench` while its unit is read, `comparing` two of its days or framing one. */
export function UnitWorkbenchSkeleton({
  comparing = false,
}: {
  comparing?: boolean;
}) {
  if (comparing) {
    return (
      <WorkbenchSkeleton
        actions={<Skeleton.Button icon />}
        subject={<DayComparisonSkeleton />}
      >
        <WorkbenchSectionSkeleton>
          <DescriptionsSkeleton justified rows={3} />
        </WorkbenchSectionSkeleton>
        <WorkbenchSectionSkeleton>
          <Skeleton.Button size="small" />
        </WorkbenchSectionSkeleton>
        <WorkbenchSectionSkeleton>
          <DescriptionsSkeleton rows={2} />
        </WorkbenchSectionSkeleton>
      </WorkbenchSkeleton>
    );
  }
  return (
    <ImageWorkbenchSkeleton
      actions={<Skeleton.Button icon />}
      facts={2}
      sections={
        <WorkbenchSectionSkeleton>
          <Skeleton.Button size="small" />
        </WorkbenchSectionSkeleton>
      }
    />
  );
}

/**
 * The photographs a unit's page frames: the day in view's, if it has one,
 * and while `compare` names a day, that day's too.
 */
function framedPictures(
  loaderData: unknown,
  compare: string | undefined,
): string[] {
  const series = loaderData as UnitDetail | undefined;
  if (!series) return [];
  return series.observations.flatMap(({ observation, image }) =>
    image &&
    (observation.id === series.observation || observation.id === compare)
      ? [image.digest]
      : [],
  );
}

function ReviewDot({ review }: { review: ReviewState }) {
  return (
    <StatusDot
      tone={imageReviewTone(review)}
      label={imageReviewLabel(review)}
    />
  );
}

function RetryButton({ image }: { image: ObservationImageRef }) {
  const action = useAsyncAction();
  return (
    <Button
      size="small"
      loading={action.busy}
      onClick={() => {
        void action.run(
          () => createImageAnalysisRetry({ data: image }),
          m.unit_photo_not_recounted(),
          { onSuccess: () => toast.success(m.unit_photo_count_queued()) },
        );
      }}
    >
      {m.unit_retry()}
    </Button>
  );
}
