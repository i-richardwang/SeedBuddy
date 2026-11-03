import type { ReactNode } from "react";

import type { Review } from "../../domain/annotation/readings";
import { sourceInstances } from "../../domain/annotation/readings";
import type { ReviewSource } from "../../domain/annotation/schema";
import {
  classCount,
  countClasses,
  countsEveryClass,
  type Tally,
  tally,
} from "../../domain/models/classes";
import { m } from "../../paraglide/messages";
import { QualityAlert } from "../../ui/DetectionQuality";
import { IdentifierName } from "../../ui/IdentifierName";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { ProgressMeter } from "../../ui/kit/Progress";
import { StatisticHero } from "../../ui/kit/Statistic";
import { Text } from "../../ui/kit/Text";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { countedClassesLabel } from "../../ui/model-names";
import { formatCount, formatNumber } from "../../ui/numbers";
import { Stepper } from "../../ui/Stepper";
import { WorkbenchSection } from "../../ui/shell/Workbench";
import { ClassLabel } from "./ClassLabel";
import { sourceLabel } from "./labels";

/**
 * How many of each class the boxes on view hold, and the number the image
 * gives its subject: their sum over the classes the subject counts, which
 * the figure names when they are fewer than the model finds. A class left
 * out of the sum is struck through. When the image has more than one
 * reading, they are offered side by side with the same sum; picking one
 * shows its boxes.
 */
export function CountsSection({
  classes,
  counted,
  counts,
  review,
  sources,
  shown,
  onShowChange,
}: {
  classes: string[];
  counted: readonly string[];
  counts: Tally;
  review: Review;
  sources: ReviewSource[];
  shown: ReviewSource | null;
  onShowChange: (source: ReviewSource) => void;
}) {
  return (
    <WorkbenchSection>
      <StatisticHero
        size="compact"
        title={m.annotation_counts()}
        value={formatCount(countClasses(counts, counted))}
        facts={
          countsEveryClass(counted, classes)
            ? undefined
            : [
                m.annotation_counted_classes({
                  classes: countedClassesLabel(counted),
                }),
              ]
        }
      />
      {classes.length > 1 ? (
        <Descriptions justified>
          {classes.map((name) => (
            <DescriptionsItem
              key={name}
              label={<ClassLabel classes={classes} name={name} />}
            >
              {counted.includes(name) ? (
                formatCount(classCount(counts, name))
              ) : (
                <Text as="span" type="quaternary" className="line-through">
                  {formatCount(classCount(counts, name))}
                </Text>
              )}
            </DescriptionsItem>
          ))}
        </Descriptions>
      ) : null}
      {sources.length > 1 ? (
        <div className="pt-2">
          <ToggleGroup
            aria-label={m.annotation_readings()}
            variant="outlined"
            value={shown ?? undefined}
            options={sources.map((source) => ({
              value: source,
              label: m.annotation_named_count({
                name: sourceLabel(source),
                count: countClasses(
                  tally(sourceInstances(review, source) ?? []),
                  counted,
                ),
              }),
            }))}
            onChange={onShowChange}
          />
        </div>
      ) : null}
    </WorkbenchSection>
  );
}

/**
 * The agent's part: the progress of a run still at work, and the boxes its
 * proposal asks a person to confirm, stepped through one at a time.
 */
export function ChecksSection({
  review,
  checks,
  at,
  onStep,
}: {
  review: Review;
  /** How many of the proposal's checks remain open against the boxes on view. */
  checks: number;
  /** The check last brought into view, if any. */
  at: number | null;
  onStep: (index: number) => void;
}) {
  const { progress } = review;
  if (!progress && checks === 0) return null;
  return (
    <WorkbenchSection title={m.ai_proposal_label()}>
      {progress ? (
        <ProgressMeter
          label={m.annotation_ai_running()}
          count={m.progress_count({
            completed: progress.completed,
            total: progress.total,
          })}
          value={progress.completed}
          max={progress.total}
        />
      ) : null}
      {checks > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <Text as="span" size="sm" type="secondary">
            {m.annotation_ai_checks()}
          </Text>
          <Stepper
            previous={{
              label: m.annotation_check_previous(),
              onClick: () => onStep(at === null ? checks - 1 : at - 1),
            }}
            next={{
              label: m.annotation_check_next(),
              onClick: () => onStep(at === null ? 0 : at + 1),
            }}
          >
            <Text as="span" type="warning" weight="medium">
              {at === null
                ? formatCount(checks)
                : m.ui_step_position({ index: at + 1, total: checks })}
            </Text>
          </Stepper>
        </div>
      ) : null}
    </WorkbenchSection>
  );
}

/** What the image is: the page's own facts about it, its file, and what read it. */
export function DetailsSection({
  review,
  facts,
}: {
  review: Review;
  facts?: ReactNode;
}) {
  const { detection } = review;
  const threshold = detection?.diagnostics?.metrics?.confidence_threshold;
  return (
    <WorkbenchSection title={m.details_label()}>
      <Descriptions>
        {facts}
        <DescriptionsItem label={m.annotation_file()}>
          {review.filename}
        </DescriptionsItem>
        {detection ? (
          <DescriptionsItem label={m.version_label()}>
            <IdentifierName id={detection.producer.modelVersionId} />
          </DescriptionsItem>
        ) : null}
        {threshold === undefined ? null : (
          <DescriptionsItem label={m.annotation_detection_threshold()}>
            {formatNumber(threshold)}
          </DescriptionsItem>
        )}
      </Descriptions>
      {detection ? <QualityAlert quality={detection.quality} /> : null}
    </WorkbenchSection>
  );
}
