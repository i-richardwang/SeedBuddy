import type { ReactNode } from "react";

import { cn } from "./cn";
import { Skeleton } from "./Skeleton";

/*
 * An object's properties, one per row of at least 30px. By default labels
 * share a fixed column so stacked lists line up; `justified` sets each label
 * at the start and its value at the end in tabular figures, for a list of
 * numbers such as training parameters.
 */

export function Descriptions({
  children,
  justified,
}: {
  children: ReactNode;
  justified?: boolean;
}) {
  return (
    <dl
      className={cn(
        "ui-descriptions",
        justified && "ui-descriptions-justified",
      )}
    >
      {children}
    </dl>
  );
}

export function DescriptionsItem({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="ui-descriptions-label">{label}</dt>
      <dd className="ui-descriptions-value">{children}</dd>
    </>
  );
}

const VALUE_WIDTHS = ["8em", "5em", "11em"] as const;

/** A `Descriptions` of `rows` properties, `justified` alike, while it loads. */
export function DescriptionsSkeleton({
  justified,
  rows,
}: {
  justified?: boolean;
  rows: number;
}) {
  return (
    <div aria-hidden>
      <Descriptions justified={justified}>
        {Array.from({ length: rows }, (_, index) => (
          <DescriptionsItem key={index} label={<Skeleton.Inline width="4em" />}>
            <Skeleton.Inline
              width={
                justified ? "2em" : VALUE_WIDTHS[index % VALUE_WIDTHS.length]!
              }
            />
          </DescriptionsItem>
        ))}
      </Descriptions>
    </div>
  );
}
