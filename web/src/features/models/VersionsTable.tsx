import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import { isReading } from "../../domain/models/comparison";
import type {
  VersionComparison,
  VersionOverview,
} from "../../domain/models/read-model";
import {
  type ModelVersion,
  validationMetric,
} from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { IdentifierName } from "../../ui/IdentifierName";
import { CopyButton } from "../../ui/kit/CopyButton";
import { Flexbox } from "../../ui/kit/Flex";
import { Status } from "../../ui/kit/Status";
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
import { Metric } from "../../ui/Metric";
import { formatCount } from "../../ui/numbers";
import { Timestamp } from "../../ui/Timestamp";
import { formatError, movement, movementTone, totalError } from "./comparison";

/**
 * A model's published versions: which one reads and which are still being
 * compared, where each came from and how many images trained it, how well
 * it scored, and how each candidate counts beside the current version. A
 * candidate's name opens its comparison, where it can be made current.
 * `empty` stands in for none.
 */
export function VersionsTable({
  versions,
  empty,
}: {
  versions: VersionOverview[];
  empty: ReactNode;
}) {
  return (
    <Table
      aria-label={m.model_versions()}
      narrow="cards"
      empty={versions.length === 0 && empty}
    >
      <TableHeader>
        <tr>
          <TableHead>{m.versions_column_version()}</TableHead>
          <TableHead>{m.versions_column_status()}</TableHead>
          <TableHead>{m.versions_column_source()}</TableHead>
          <TableHead>{m.versions_column_published()}</TableHead>
          <TableHead className="w-28" numeric>
            {m.versions_column_trained_on()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.epoch_series_map50()}
          </TableHead>
          <TableHead className="w-28" numeric>
            {m.epoch_series_map50_95()}
          </TableHead>
          <TableHead>{m.versions_column_comparison()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.versions_column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {versions.map(({ version, training, current, comparison }) => (
          <TableRow key={version.id} clickable={!current}>
            <TableCell cellSlot="title">
              <IdentifierName
                id={version.id}
                render={
                  current ? undefined : (
                    <TextLink
                      render={
                        <Link
                          to="/models/$model"
                          params={{ model: version.modelId }}
                          search={{ version: version.id }}
                          resetScroll={false}
                        />
                      }
                    />
                  )
                }
              />
            </TableCell>
            <TableCell
              cellLabel={m.versions_column_status()}
              className="whitespace-nowrap"
            >
              <VersionStatus current={current} comparison={comparison} />
            </TableCell>
            <TableCell
              cellLabel={m.versions_column_source()}
              className="whitespace-nowrap"
            >
              <VersionSource version={version} training={training} />
            </TableCell>
            <TableCell
              cellLabel={m.versions_column_published()}
              className="whitespace-nowrap"
            >
              <Timestamp value={version.createdAt} />
            </TableCell>
            <TableCell cellLabel={m.versions_column_trained_on()} numeric>
              {training ? (
                m.versions_trained_images({ count: training.images })
              ) : (
                <Absent />
              )}
            </TableCell>
            <TableCell cellLabel={m.epoch_series_map50()} numeric>
              <Metric value={validationMetric(version.artifact, "map50")} />
            </TableCell>
            <TableCell cellLabel={m.epoch_series_map50_95()} numeric>
              <Metric value={validationMetric(version.artifact, "map50To95")} />
            </TableCell>
            <TableCell
              cellLabel={m.versions_column_comparison()}
              className="whitespace-nowrap"
            >
              {current ? null : <CountError comparison={comparison} />}
            </TableCell>
            <TableCell cellSlot="actions" className="text-end">
              <CopyButton content={version.id} title={m.version_copy_id()} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The version that reads, or a candidate whose held-out images are still being read. */
function VersionStatus({
  current,
  comparison,
}: {
  current: boolean;
  comparison: VersionComparison | null;
}) {
  if (current) return <Status tone="success">{m.versions_current()}</Status>;
  if (!comparison || !isReading(comparison)) return null;
  return (
    <Status tone="info" icon={LoaderCircle} spin>
      {m.versions_comparing({
        read: formatCount(comparison.candidate.read),
        total: formatCount(comparison.heldOut),
      })}
    </Status>
  );
}

/** Built in, imported, or trained by a run, which it links to. */
function VersionSource({
  version,
  training,
}: {
  version: ModelVersion;
  training: VersionOverview["training"];
}) {
  const { source } = version;
  if (source.kind === "builtin") return m.version_source_builtin();
  if (source.kind === "import") return m.version_source_import();
  const label = m.version_source_training({
    run: identifierLabel(source.trainingRunId),
  });
  if (!training) return label;
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/runs/$runId"
          params={{ dataset: training.datasetId, runId: training.runId }}
        />
      }
    >
      {label}
    </TextLink>
  );
}

/**
 * The candidate's count error beside the current version's over the images
 * both have read, colored by which way it moves, and how many images that
 * is; nothing yet while no image has been read by both.
 */
function CountError({ comparison }: { comparison: VersionComparison | null }) {
  const accuracy = comparison?.accuracy;
  if (!comparison || !accuracy) return <Absent />;
  const candidate = totalError(accuracy.candidate);
  const current = accuracy.current ? totalError(accuracy.current) : null;
  const moved = current === null ? "none" : movement(current, candidate);
  return (
    <Flexbox horizontal align="baseline" gap={8}>
      <Text as="span" type={movementTone(moved)}>
        {current === null
          ? formatError(candidate)
          : m.versions_comparison_error({
              current: formatError(current),
              candidate: formatError(candidate),
            })}
      </Text>
      <Text as="span" type="tertiary">
        {m.versions_comparison_images({
          count: formatCount(comparison.scored),
        })}
      </Text>
    </Flexbox>
  );
}
