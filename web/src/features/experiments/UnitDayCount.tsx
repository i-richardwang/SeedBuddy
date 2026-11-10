import { EyeOff, ImageIcon, PencilLine } from "lucide-react";
import type { ReactElement } from "react";

import type { SheetCell } from "../../domain/experiments/read-model";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { cn } from "../../ui/kit/cn";
import { Icon } from "../../ui/kit/Icon";
import { Status } from "../../ui/kit/Status";
import { Text } from "../../ui/kit/Text";
import { Tooltip } from "../../ui/kit/Tooltip";
import { formatList } from "../../ui/lists";
import { classLabel } from "../../ui/model-names";
import { formatCount } from "../../ui/numbers";
import { datasetImageStateLabel } from "../datasets/labels";
import { exclusionNote } from "./labels";

/**
 * A unit's count on one day, or why there is none, read alike wherever the
 * day is shown. A count a person stands behind, by reviewing the photograph
 * or by entering it, is shown plain, and one nobody has reviewed yet
 * provisional; a count entered by hand carries a small mark saying so. One
 * read by a version that does not find every class of its model names the
 * classes it could not tell apart. One left out of the analysis is struck
 * through. A photograph not yet counted shows as a photograph, a day with
 * neither photograph nor count as absent, and only a failed count asks for
 * attention. A photograph found unclear is marked wherever it is shown,
 * whether or not the experiment counts it; where it does not, its unit is
 * struck through on every day and the mark says which photograph did it.
 * `link` wraps what is shown in a way to the day.
 */
export function UnitDayCount({
  cell,
  link = (content) => content,
}: {
  /**
   * The day resolved: its reading and why it stays out of the analysis, if
   * it does, over the photograph and the entered count it came from.
   */
  cell: Pick<SheetCell, "reading" | "exclusion" | "image" | "manual">;
  link?: (content: ReactElement) => ReactElement;
}) {
  if (!cell.image && !cell.manual) return <Absent />;
  const { image, manual, reading, exclusion } = cell;
  // A count entered by hand that leaves out a class the day has since come
  // to count answers another question than the day asks, and says so.
  const notes: string[] = [
    ...(image?.unclear ? [m.unclear_photo()] : []),
    ...(manual && reading?.source !== "manual"
      ? [m.experiment_cell_manual_unanswered()]
      : []),
  ];
  if (reading) {
    const included = exclusion === null;
    const byPerson = reading.source === "review" || reading.source === "manual";
    if (reading.source === "manual") notes.push(m.experiment_cell_manual());
    else if (reading.source !== "review") {
      notes.push(m.to_review_label());
    }
    if (reading.unfound.length > 0) {
      notes.push(
        m.experiment_cell_unfound({
          classes: formatList(reading.unfound.map(classLabel)),
        }),
      );
    }
    if (exclusion) notes.push(exclusionNote(exclusion));
    return explain(
      notes,
      link(
        <Text
          as="span"
          type={!included ? "quaternary" : byPerson ? undefined : "tertiary"}
          weight={byPerson ? "medium" : undefined}
          className={cn(
            "inline-flex items-center gap-1 tabular-nums",
            !included && "line-through",
          )}
        >
          {formatCount(reading.count)}
          {reading.source === "manual" ? (
            <Icon
              icon={PencilLine}
              size={12}
              aria-label={m.experiment_cell_manual()}
            />
          ) : null}
          {image?.unclear ? (
            <Icon icon={EyeOff} size={12} aria-label={m.unclear_label()} />
          ) : null}
        </Text>,
      ),
    );
  }
  if (!image) {
    return explain(
      notes,
      link(
        <Text as="span" type="tertiary">
          <Icon
            icon={PencilLine}
            size={14}
            aria-label={m.experiment_cell_manual_unanswered()}
            className="align-middle"
          />
        </Text>,
      ),
    );
  }
  if (image.state === "failed") {
    return explain(
      [...notes, ...(image.error ? [image.error] : [])],
      link(<Status tone="error">{m.failed_label()}</Status>),
    );
  }
  const waiting =
    image.state === "unread"
      ? datasetImageStateLabel("unread")
      : m.experiment_cell_waiting();
  return explain(
    [...notes, waiting],
    link(
      <Text as="span" type="tertiary">
        <Icon
          icon={ImageIcon}
          size={14}
          aria-label={waiting}
          className="align-middle"
        />
      </Text>,
    ),
  );
}

/** A count's notes, one per line, in a tooltip over it. */
function explain(notes: readonly string[], control: ReactElement) {
  if (notes.length === 0) return control;
  return (
    <Tooltip
      title={
        <span className="flex max-w-xs flex-col">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      }
    >
      {control}
    </Tooltip>
  );
}
