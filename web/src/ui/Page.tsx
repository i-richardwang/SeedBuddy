import type { ReactNode } from "react";

import type { IconProps } from "./kit/Icon";
import { PageHeader } from "./kit/PageHeader";
import { PageHeaderSkeleton, PageSkeleton } from "./kit/PageSkeleton";
import { type Preview, PreviewLayout } from "./kit/PreviewLayout";
import { SectionHeader } from "./kit/SectionHeader";
import { Skeleton } from "./kit/Skeleton";
import { ShellTrail } from "./shell/Shell";

/* A document page runs the card's full width; its parts are 24px apart. */
const COLUMN = "flex w-full flex-col gap-6 max-mobile:gap-4";

/**
 * A document page in the shell's card: a `PageHeader` carrying the page's
 * `actions`, then the page's figure and sections. A page about one thing sets
 * its `icon`, `status` and `meta`. A page below another names the way back
 * up in the shell's top bar, from the route's crumbs. A page that previews
 * its rows beside itself passes `preview`, null while nothing is open, and
 * fills the card edge to edge.
 */
export function Page({
  title,
  icon,
  description,
  status,
  meta,
  actions,
  preview,
  children,
}: {
  title: string;
  /** The subject's mark, as its card in the list carries it. */
  icon?: IconProps["icon"];
  description?: ReactNode;
  /** The subject's state, right after the title. */
  status?: ReactNode;
  /** Facts about the subject under the description. */
  meta?: ReactNode[];
  /** Commands at the header's end: at most one primary button, then a menu. */
  actions?: ReactNode;
  preview?: Preview | null;
  children: ReactNode;
}) {
  const column = (
    <div className={COLUMN}>
      <ShellTrail />
      <PageHeader
        icon={icon}
        title={title}
        description={description}
        status={status}
        meta={meta}
        actions={actions}
      />
      {children}
    </div>
  );
  return preview === undefined ? (
    column
  ) : (
    <PreviewLayout preview={preview}>{column}</PreviewLayout>
  );
}

/** A `Page` while it loads, in the same column. */
export function PageColumnSkeleton({ children }: { children: ReactNode }) {
  return (
    <PageSkeleton>
      <div className={COLUMN}>{children}</div>
    </PageSkeleton>
  );
}

/**
 * A titled part of a document page: its `SectionHeader`, with `extra` at the
 * end of the heading row (a count, a small button), over its content.
 */
export function PageSection({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} extra={extra} />
      {children}
    </section>
  );
}

/** A `PageSection` while it loads: the heading's bone above the content's. */
export function PageSectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <section aria-hidden className="flex flex-col gap-3">
      <Skeleton.Text size="lg" width="8em" />
      {children}
    </section>
  );
}

/*
 * The reading column of a settings page: at most 1024px wide and centered,
 * groups 36px apart, and room under the last group (with the card's own
 * padding, 128px).
 */
const SETTINGS_COLUMN = "mx-auto flex w-full max-w-5xl flex-col gap-9 pb-26";

/**
 * A settings page: the reader's own account, keys and connections, or the
 * workspace's people and Workers. Its `PageHeader` names it and carries the
 * page's one command, ruled off from the content: a column of
 * `SettingsGroup`s, or for a page that is one roster, the roster itself.
 */
export function SettingsPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={SETTINGS_COLUMN}>
      <div className="flex flex-col gap-6 pt-3">
        <PageHeader title={title} actions={actions} />
        <hr className="border-border-secondary" />
      </div>
      {children}
    </div>
  );
}

/** A `SettingsPage` while it loads: its header's bones, then `children` such as `SettingsGroupSkeleton`s. */
export function SettingsPageSkeleton({ children }: { children: ReactNode }) {
  return (
    <PageSkeleton>
      <div className={SETTINGS_COLUMN}>
        <div aria-hidden className="flex flex-col gap-6 pt-3">
          <PageHeaderSkeleton />
          <hr className="border-border-secondary" />
        </div>
        {children}
      </div>
    </PageSkeleton>
  );
}
