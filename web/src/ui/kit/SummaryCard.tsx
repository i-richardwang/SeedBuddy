import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ArrowRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { EmptyPlace } from "./Empty";
import { Icon, type IconProps } from "./Icon";
import { IconTile } from "./IconTile";
import { Skeleton } from "./Skeleton";
import { OverflowTooltip } from "./Tooltip";

/*
 * Things a reader opens one at a time, laid out as `SummaryCard`s: columns
 * at least 480px wide, 20px apart, one column on a phone. With no things,
 * its `empty` stands in its place on a dashed band of fill.
 */
export function CardGrid({
  "aria-label": ariaLabel,
  children,
  empty,
}: {
  "aria-label": string;
  children: ReactNode;
  empty?: ReactNode;
}) {
  if (empty !== undefined) {
    return <EmptyPlace variant="outlined">{empty}</EmptyPlace>;
  }
  return (
    <ul aria-label={ariaLabel} className="ui-card-grid">
      {children}
    </ul>
  );
}

/*
 * One thing at a glance, linking to its page: its icon tile, its name (16px,
 * 600) over a line of facts, an arrow at the end of that row; and at the
 * foot `footer`, usually `SummaryCardStats`. `render` is the link, a router
 * `<Link>`; the name and the arrow both follow it, the arrow hidden from
 * assistive technology.
 */
export function SummaryCard({
  description,
  footer,
  icon,
  render,
  title,
}: {
  description?: ReactNode;
  footer?: ReactNode;
  icon: IconProps["icon"];
  render: ReactElement;
  title: ReactNode;
}) {
  const name = useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { className: "ui-summary-card-name" },
      { children: title },
    ),
    render,
  });
  const arrow = useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { "aria-hidden": true, className: "ui-summary-card-arrow", tabIndex: -1 },
      { children: <Icon icon={ArrowRight} size={16} /> },
    ),
    render,
  });
  return (
    <li className="ui-summary-card">
      <div className="ui-summary-card-identity">
        <IconTile icon={icon} />
        <div className="ui-summary-card-heading">
          {typeof title === "string" ? (
            <OverflowTooltip title={title}>{name}</OverflowTooltip>
          ) : (
            name
          )}
          {description != null ? (
            <span className="ui-summary-card-description">{description}</span>
          ) : null}
        </div>
        {arrow}
      </div>
      {footer != null ? (
        <div className="ui-summary-card-foot">{footer}</div>
      ) : null}
    </li>
  );
}

/** Counts along the card's foot, each a figure over its label, divided by hairlines. */
export function SummaryCardStats({
  items,
}: {
  items: { label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="ui-summary-card-stats">
      {items.map((item, index) => (
        <div className="ui-summary-card-stat" key={index}>
          <dd>{item.value}</dd>
          <dt>{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A `CardGrid` while it loads. */
export function CardGridSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div aria-hidden className="ui-card-grid">
      {Array.from({ length: cards }, (_, index) => (
        <div className="ui-summary-card" key={index}>
          <div className="ui-summary-card-identity">
            <Skeleton className="ui-summary-card-skeleton-tile" />
            <div className="ui-summary-card-heading">
              <Skeleton.Text size="lg" width="10em" />
              <Skeleton.Text size="xs" width="14em" />
            </div>
          </div>
          <Skeleton.Text width="12em" />
        </div>
      ))}
    </div>
  );
}
