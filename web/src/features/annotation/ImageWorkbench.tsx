import { Lock, LockOpen } from "lucide-react";
import { type ReactNode, useState } from "react";

import { openChecks } from "../../domain/annotation/checks";
import {
  availableSources,
  type Review,
} from "../../domain/annotation/readings";
import type { ReviewSource } from "../../domain/annotation/schema";
import { tally } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { DescriptionsSkeleton } from "../../ui/kit/Descriptions";
import { StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { Status } from "../../ui/kit/Status";
import { ToolbarSeparator } from "../../ui/kit/Toolbar";
import { Tooltip } from "../../ui/kit/Tooltip";
import { ShellActions } from "../../ui/shell/Shell";
import {
  Workbench,
  WorkbenchAlert,
  WorkbenchInspector,
  WorkbenchSection,
  WorkbenchSectionSkeleton,
  WorkbenchSkeleton,
  WorkbenchStatus,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import {
  ImageViewport,
  type ViewportFocus,
} from "../../ui/viewport/ImageViewport";
import { UnclearAlert, UnclearSection } from "../images/unclear";
import { ChecksLayer, EditableBoxLayer } from "./BoxLayer";
import type { LayerKey } from "./controls";
import { ChecksSection, CountsSection, DetailsSection } from "./inspector";
import { useSaveKey, useWorkbenchKeys } from "./keys";
import { standingLabel, standingTone } from "./labels";
import { setEditLocked, useEditLocked } from "./lock";
import { useImageSession } from "./session";
import { EditTools, LayerControls } from "./tools";
import type { ImageWorkbenchContext } from "./types";

interface ImageSubjectProps {
  model: Model;
  review: Review;
  /** Whether a person marked the photograph unclear. */
  unclear: boolean;
  show?: ReviewSource;
  /** Shows another reading; none returns to the best. */
  onShowChange: (source: ReviewSource | undefined) => void;
  /** Opens the next image still to review, when there is one. */
  onNext?: () => unknown;
  /** Another image is on its way; this one stays until it can be replaced whole. */
  stepping?: boolean;
  context?: ImageWorkbenchContext;
}

/**
 * A workbench framing one image for review. Its frame, and the way to the
 * images beside this one in its footer, stay in place from one image to the
 * next; the image, its boxes and everything said about them start afresh.
 */
export function ImageWorkbench({
  title,
  ...subject
}: ImageSubjectProps & { title: string }) {
  return (
    <Workbench title={title}>
      {subject.context?.steps}
      <ImageSubject
        key={`${subject.model.id}:${subject.review.ref.digest}`}
        {...subject}
      />
    </Workbench>
  );
}

/**
 * An `ImageWorkbench` while its image is read: the count over its classes,
 * the page's own `sections`, and the details: the file, after as many
 * `facts` as the page always adds.
 */
export function ImageWorkbenchSkeleton({
  actions,
  facts = 0,
  sections,
}: {
  actions?: ReactNode;
  facts?: number;
  sections?: ReactNode;
}) {
  return (
    <WorkbenchSkeleton actions={actions}>
      <WorkbenchSection>
        <StatisticHeroSkeleton size="compact" />
        <DescriptionsSkeleton justified rows={2} />
      </WorkbenchSection>
      {sections}
      <WorkbenchSectionSkeleton>
        <DescriptionsSkeleton rows={facts + 1} />
      </WorkbenchSectionSkeleton>
    </WorkbenchSkeleton>
  );
}

/**
 * One image and its boxes, on view for review inside a `Workbench`. The
 * boxes begin as the reading on view, the best one unless another is picked.
 * They are locked until the lock leading the toolbar is opened; then the
 * editing tools show and any edit begins a draft. The primary command
 * stores the boxes as the image's review and stays: it saves edits, or
 * confirms a Worker's reading taken as it is, as Mod+S does. On a reviewed image it leads
 * to the next one still to review. Where an AI proposal is on view, the places it
 * asks a person to check are outlined, counted and stepped through. Whether
 * the photograph is clear is said beside it and saved on its own. Mounted
 * under a key of its image, so nothing of one image carries into the next.
 */
export function ImageSubject({
  model,
  review,
  unclear,
  show,
  onShowChange,
  onNext,
  stepping = false,
  context = {},
}: ImageSubjectProps) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(["boxes", "checks"]),
  );
  const sources = availableSources(review);
  const shown = show && sources.includes(show) ? show : (sources[0] ?? null);
  const locked = useEditLocked();
  const session = useImageSession({ review, shown, model, locked });
  const { standing, saving, instances } = session;
  const checks =
    review.proposal && session.origin === "proposal"
      ? openChecks(review.proposal, instances)
      : [];
  // Each step brings its check into view again, even one already there.
  const [visit, setVisit] = useState<{ at: number; count: number } | null>(
    null,
  );
  const checkAt = visit && visit.at < checks.length ? visit.at : null;
  const focus: ViewportFocus | null =
    checkAt === null
      ? null
      : { key: String(visit!.count), region: checks[checkAt]!.bbox };
  const stepCheck = (index: number) =>
    setVisit((previous) => ({
      at: (index + checks.length) % checks.length,
      count: (previous?.count ?? 0) + 1,
    }));

  const store = async () => {
    if (await session.confirm()) onShowChange(undefined);
  };
  const ready = !saving && !session.conflict;
  const stores = standing !== "reviewed";
  const primary = stores
    ? {
        label:
          standing === "edited" ? m.annotation_save() : m.annotation_confirm(),
        run: store,
      }
    : onNext && { label: m.annotation_next_unreviewed(), run: onNext };
  useWorkbenchKeys({ Enter: primary && ready ? primary.run : undefined });
  useSaveKey(stores && ready ? store : undefined);

  return (
    <>
      <WorkbenchStatus>
        <Status tone={standingTone(standing)}>{standingLabel(standing)}</Status>
      </WorkbenchStatus>
      <ShellActions>
        {standing === "edited" ? (
          <Button type="text" disabled={saving} onClick={session.discard}>
            {m.annotation_discard_edits()}
          </Button>
        ) : null}
        {primary ? (
          <Tooltip hotkey={stores ? "mod+s" : undefined} placement="bottom">
            <Button
              type="primary"
              loading={saving}
              disabled={session.conflict !== null}
              onClick={primary.run}
            >
              {primary.label}
            </Button>
          </Tooltip>
        ) : null}
        <div inert={saving || undefined} className="contents">
          {context.menu}
        </div>
      </ShellActions>
      {session.conflict ? (
        <WorkbenchAlert>
          <Alert
            type="warning"
            title={m.annotation_conflict()}
            description={m.annotation_conflict_description()}
            action={
              <Button size="small" onClick={session.conflict.reload}>
                {m.annotation_reload()}
              </Button>
            }
          />
        </WorkbenchAlert>
      ) : null}
      {context.alert ? <WorkbenchAlert>{context.alert}</WorkbenchAlert> : null}
      {unclear ? (
        <WorkbenchAlert>
          <UnclearAlert />
        </WorkbenchAlert>
      ) : null}
      <WorkbenchToolbar label={m.annotation_tools()} inert={saving}>
        <ActionIcon
          icon={locked ? LockOpen : Lock}
          size="small"
          title={locked ? m.annotation_unlock() : m.annotation_lock()}
          tooltipProps={{ placement: "bottom" }}
          onClick={() => {
            session.setSelectedId(null);
            setEditLocked(!locked);
          }}
        />
        {locked ? null : (
          <>
            <ToolbarSeparator />
            <EditTools
              classes={model.classes}
              tally={tally(instances)}
              boxClass={session.boxClass}
              onClassChange={session.changeClass}
              history={session.history}
              onUndo={session.undo}
              onRedo={session.redo}
              canDelete={session.selectedId !== null}
              onDelete={session.deleteSelected}
            />
          </>
        )}
      </WorkbenchToolbar>
      <WorkbenchInspector>
        <CountsSection
          classes={model.classes}
          counted={context.counted ?? model.classes}
          counts={tally(instances)}
          review={review}
          sources={sources}
          shown={shown}
          onShowChange={onShowChange}
        />
        <ChecksSection
          review={review}
          checks={checks.length}
          at={checkAt}
          onStep={stepCheck}
        />
        {context.sections}
        <UnclearSection digest={review.ref.digest} unclear={unclear} />
        <DetailsSection review={review} facts={context.facts} />
      </WorkbenchInspector>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
        focus={focus}
        pending={stepping}
        controls={
          <LayerControls
            available={
              review.proposal ? ["boxes", "ids", "checks"] : ["boxes", "ids"]
            }
            layers={layers}
            onLayersChange={setLayers}
          />
        }
      >
        <EditableBoxLayer
          image={review}
          classes={model.classes}
          instances={instances}
          layers={layers}
          panning={session.panning || saving || locked}
          activeClass={session.activeClass}
          selectedId={session.selectedId}
          onSelect={session.setSelectedId}
          onClassChange={session.changeClass}
          onInstancesChange={session.replaceInstances}
        />
        <ChecksLayer image={review} checks={checks} layers={layers} />
      </ImageViewport>
    </>
  );
}
