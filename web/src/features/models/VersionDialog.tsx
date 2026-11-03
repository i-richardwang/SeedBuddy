import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import { classCount, type Tally } from "../../domain/models/classes";
import {
  countError,
  isCounted,
  isReading,
} from "../../domain/models/comparison";
import type {
  ComparedImage,
  ComparedReading,
  CountAccuracy,
  VersionComparisonDetail,
} from "../../domain/models/read-model";
import type { Model, ModelVersion } from "../../domain/models/schema";
import { chooseCurrentVersion } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { IdentifierName } from "../../ui/IdentifierName";
import { CopyButton } from "../../ui/kit/CopyButton";
import { Flexbox } from "../../ui/kit/Flex";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";
import { classLabel } from "../../ui/model-names";
import { formatCount, formatCountChange } from "../../ui/numbers";
import {
  formatError,
  formatErrorChange,
  movement,
  movementTone,
  totalError,
} from "./comparison";

const FORM_ID = "make-version-current";

/**
 * Where a person decides whether a version should read the model's images:
 * how it counts the reviewed images it never trained on beside the current
 * version, image by image, and what choosing it changes. It is open while
 * `version` names one, and keeps showing that version while it closes.
 */
export function VersionDialog({
  model,
  version,
  comparison,
  onClose,
}: {
  model: Model;
  version: ModelVersion | null;
  comparison: VersionComparisonDetail | null;
  onClose: () => void;
}) {
  const open = version !== null;
  const [shown, setShown] = useState({ version, comparison });
  if (open && (shown.version !== version || shown.comparison !== comparison)) {
    setShown({ version, comparison });
  }
  return (
    <DialogSession open={open}>
      {(afterClose) =>
        shown.version ? (
          <VersionSession
            model={model}
            version={shown.version}
            comparison={shown.comparison}
            open={open}
            onClose={onClose}
            afterClose={afterClose}
          />
        ) : null
      }
    </DialogSession>
  );
}

function VersionSession({
  model,
  version,
  comparison,
  open,
  onClose,
  afterClose,
}: {
  model: Model;
  version: ModelVersion;
  comparison: VersionComparisonDetail | null;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const { busy, run } = useAsyncAction();
  const label = identifierLabel(version.id);

  const submit = () => {
    void run(
      () =>
        chooseCurrentVersion({
          data: { model: model.id, version: version.id },
        }),
      m.version_not_made_current(),
      {
        onSuccess: () => {
          toast.success(m.version_made_current({ version: label }));
          onClose();
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.version_dialog_title({ version: label })}
      okText={m.version_dialog_confirm()}
      formId={FORM_ID}
      busy={busy}
      width="wide"
      afterClose={afterClose}
    >
      <form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Flexbox gap={16}>
          {version.source.kind === "import" ? (
            <Text type="secondary">
              {m.version_imported_provenance({
                description: version.source.provenance.dataset.description,
              })}
            </Text>
          ) : null}
          {comparison ? (
            <Comparison model={model} comparison={comparison} />
          ) : (
            <Text type="secondary">{m.version_dialog_no_comparison()}</Text>
          )}
          <Text type="tertiary">{m.version_dialog_effect()}</Text>
        </Flexbox>
      </form>
    </FormDialog>
  );
}

function Comparison({
  model,
  comparison,
}: {
  model: Model;
  comparison: VersionComparisonDetail;
}) {
  const { heldOut, candidate, current, accuracy, currentVersionId } =
    comparison;
  const total = formatCount(heldOut);
  const failed = comparison.images.filter(
    (image) => image.candidate === "failed" || image.current === "failed",
  ).length;
  const currentLabel =
    currentVersionId === null
      ? null
      : m.version_dialog_column_current({
          version: identifierLabel(currentVersionId),
        });
  return (
    <Flexbox gap={12}>
      <Text type="secondary">
        {m.version_dialog_held_out({
          count: heldOut,
          hasCurrent: currentVersionId === null ? "no" : "yes",
        })}
      </Text>
      {isReading(comparison) ? (
        <Text type="tertiary">
          {current
            ? m.version_dialog_reading({
                candidate: formatCount(candidate.read),
                current: formatCount(current.read),
                total,
              })
            : m.version_dialog_reading_alone({
                candidate: formatCount(candidate.read),
                total,
              })}
        </Text>
      ) : null}
      {failed > 0 ? (
        <Text type="warning">
          {m.version_dialog_failed({ count: formatCount(failed) })}
        </Text>
      ) : null}
      {accuracy ? (
        <AccuracyTable
          classes={model.classes}
          candidate={accuracy.candidate}
          current={
            currentLabel && accuracy.current
              ? { label: currentLabel, accuracy: accuracy.current }
              : null
          }
        />
      ) : (
        <Text type="tertiary">{m.version_dialog_waiting()}</Text>
      )}
      <ImageTable
        classes={model.classes}
        currentLabel={currentLabel}
        images={comparison.images}
      />
    </Flexbox>
  );
}

/**
 * Each class's mean count error and their total, the current version beside
 * this one and how far this one moves each.
 */
function AccuracyTable({
  classes,
  candidate,
  current,
}: {
  classes: readonly string[];
  candidate: CountAccuracy;
  current: { label: string; accuracy: CountAccuracy } | null;
}) {
  const rows = [
    ...classes.map((name) => ({
      key: name,
      label: m.version_dialog_mean_error({ class: classLabel(name) }),
      error: (accuracy: CountAccuracy) => accuracy.meanError[name] ?? 0,
    })),
    {
      key: "total",
      label: m.version_dialog_total_error(),
      error: totalError,
    },
  ];
  return (
    <Table aria-label={m.version_dialog_metric()} size="small">
      <TableHeader>
        <tr>
          <TableHead>{m.version_dialog_metric()}</TableHead>
          {current ? <TableHead numeric>{current.label}</TableHead> : null}
          <TableHead numeric>{m.version_dialog_column_candidate()}</TableHead>
          {current ? (
            <TableHead numeric>{m.version_dialog_column_change()}</TableHead>
          ) : null}
        </tr>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="whitespace-nowrap">{row.label}</TableCell>
            {current ? (
              <TableCell numeric>
                {formatError(row.error(current.accuracy))}
              </TableCell>
            ) : null}
            <TableCell numeric>{formatError(row.error(candidate))}</TableCell>
            {current ? (
              <TableCell numeric>
                <ErrorChange
                  from={row.error(current.accuracy)}
                  to={row.error(candidate)}
                />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** How far an error moves, signed, in the color of its direction. */
function ErrorChange({ from, to }: { from: number; to: number }) {
  const moved = movement(from, to);
  return (
    <Text as="span" type={movementTone(moved) ?? "quaternary"}>
      {formatErrorChange(moved === "none" ? 0 : to - from)}
    </Text>
  );
}

function errorOf(
  classes: readonly string[],
  image: ComparedImage,
  reading: ComparedReading,
): number {
  return isCounted(reading) ? countError(classes, image.reviewed, reading) : -1;
}

/**
 * The held-out images, the ones either version miscounts most first: the
 * reviewer's count of each class, then how far each version's count is from
 * it, each class in a column of its own under the version's group.
 */
function ImageTable({
  classes,
  currentLabel,
  images,
}: {
  classes: readonly string[];
  currentLabel: string | null;
  images: readonly ComparedImage[];
}) {
  const sorted = [...images].sort(
    (left, right) =>
      Math.max(
        errorOf(classes, right, right.candidate),
        errorOf(classes, right, right.current),
      ) -
      Math.max(
        errorOf(classes, left, left.candidate),
        errorOf(classes, left, left.current),
      ),
  );
  const reviewedLabel = m.version_dialog_column_reviewed();
  const candidateLabel = m.version_dialog_column_candidate();
  const groups = currentLabel
    ? [reviewedLabel, currentLabel, candidateLabel]
    : [reviewedLabel, candidateLabel];
  return (
    <Flexbox gap={8}>
      <Flexbox gap={2}>
        <Text weight="medium">{m.version_dialog_images()}</Text>
        <Text type="tertiary">{m.version_dialog_images_description()}</Text>
      </Flexbox>
      <Table aria-label={m.version_dialog_images()} size="small" narrow="cards">
        <TableHeader>
          <tr>
            <TableHead rowSpan={2}>{m.version_dialog_column_image()}</TableHead>
            {groups.map((group) => (
              <TableHead key={group} colSpan={classes.length}>
                {group}
              </TableHead>
            ))}
            <TableHead rowSpan={2} className="w-12">
              <span className="sr-only">{m.column_actions()}</span>
            </TableHead>
          </tr>
          <tr>
            {groups.flatMap((group) =>
              classes.map((name) => (
                <TableHead key={`${group}:${name}`} numeric>
                  {classLabel(name)}
                </TableHead>
              )),
            )}
          </tr>
        </TableHeader>
        <TableBody>
          {sorted.map((image) => (
            <TableRow key={image.digest}>
              <TableCell cellSlot="title">
                <ImageName image={image} />
              </TableCell>
              {classes.map((name) => (
                <TableCell
                  key={name}
                  cellLabel={m.version_dialog_cell_label({
                    column: reviewedLabel,
                    class: classLabel(name),
                  })}
                  numeric
                >
                  {formatCount(classCount(image.reviewed, name))}
                </TableCell>
              ))}
              {currentLabel ? (
                <ReadingCells
                  classes={classes}
                  column={currentLabel}
                  reviewed={image.reviewed}
                  reading={image.current}
                />
              ) : null}
              <ReadingCells
                classes={classes}
                column={candidateLabel}
                reviewed={image.reviewed}
                reading={image.candidate}
              />
              <TableCell cellSlot="actions">
                <CopyButton content={image.digest} title={m.image_copy_id()} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Flexbox>
  );
}

function ImageName({ image }: { image: ComparedImage }) {
  if (!image.dataset) {
    return (
      <Text as="span" type="tertiary">
        <IdentifierName id={image.digest} />
      </Text>
    );
  }
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/$digest"
          params={{ dataset: image.dataset.id, digest: image.digest }}
        />
      }
    >
      {image.dataset.filename}
    </TextLink>
  );
}

/**
 * One version's reading of an image: for each class how far its count is
 * from the reviewer's, an exact count stepping back; a reading still to
 * come or not made spans the version's columns.
 */
function ReadingCells({
  classes,
  column,
  reviewed,
  reading,
}: {
  classes: readonly string[];
  column: string;
  reviewed: Tally;
  reading: ComparedReading;
}) {
  if (reading === null || reading === "failed") {
    return (
      <TableCell cellLabel={column} colSpan={classes.length} numeric>
        {reading === null ? (
          <Text as="span" type="quaternary">
            {m.version_dialog_pending()}
          </Text>
        ) : (
          <Text as="span" type="warning">
            {m.version_dialog_failed_cell()}
          </Text>
        )}
      </TableCell>
    );
  }
  return classes.map((name) => {
    const off = classCount(reading, name) - classCount(reviewed, name);
    return (
      <TableCell
        key={name}
        cellLabel={m.version_dialog_cell_label({
          column,
          class: classLabel(name),
        })}
        numeric
      >
        <Text as="span" type={off === 0 ? "quaternary" : undefined}>
          {formatCountChange(off)}
        </Text>
      </TableCell>
    );
  });
}
