import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { Skeleton } from "./Skeleton";

/*
 * Loading shape of a page. `PageSkeleton` is the root: it stacks its parts
 * like the page's content and announces the load in a polite live region.
 * The parts (`PageHeaderSkeleton`, `TabsSkeleton`, `TableSkeleton`, and the
 * skeletons kept beside other components, such as `StatisticHeroSkeleton`)
 * are laid out in the order the page draws them. Bones are sized by their
 * classes.
 */

const LINE_WIDTHS = ["68%", "52%", "76%", "58%"] as const;
const HEAD = [96, 72, 64, 48];

export function PageSkeleton({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true" className="ui-page-skeleton">
      <output aria-live="polite" className="sr-only">
        {m.ui_page_loading()}
      </output>
      {children}
    </div>
  );
}

/** A `PageHeader`; `icon`, `description` and `meta` match what it shows. */
export function PageHeaderSkeleton({
  description,
  icon,
  meta,
}: {
  description?: boolean;
  icon?: boolean;
  meta?: boolean;
}) {
  return (
    <div aria-hidden className="ui-page-skeleton-header">
      {icon ? <Skeleton className="ui-page-skeleton-icon" /> : null}
      <div className="ui-page-skeleton-heading">
        <Skeleton className="ui-page-skeleton-title" />
        {description ? <Skeleton.Text width="46%" /> : null}
        {meta ? <Skeleton.Text size="xs" width="16em" /> : null}
      </div>
    </div>
  );
}

/** `Tabs`, a bone for each of `tabs` labels. */
export function TabsSkeleton({ tabs }: { tabs: number }) {
  return (
    <div aria-hidden className="ui-tabs">
      <div className="ui-tabs-list">
        {Array.from({ length: tabs }, (_, index) => (
          <span className="ui-tabs-tab" key={index}>
            <Skeleton.Inline width="4em" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** An outlined `Table`: its header band and `rows` rows in the same card. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="ui-page-skeleton-table">
      <div className="ui-page-skeleton-thead">
        {HEAD.map((width) => (
          <Skeleton
            className="ui-page-skeleton-thead-cell"
            key={width}
            width={width}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-page-skeleton-row" key={index}>
          <div className="ui-page-skeleton-copy">
            <Skeleton.Text width={LINE_WIDTHS[index % LINE_WIDTHS.length]!} />
          </div>
          <Skeleton className="ui-page-skeleton-tag" />
          <Skeleton className="ui-page-skeleton-cell" />
        </div>
      ))}
    </div>
  );
}
