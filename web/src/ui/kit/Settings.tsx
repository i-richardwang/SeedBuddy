import type { ReactNode } from "react";

import { SectionHeader } from "./SectionHeader";
import { Skeleton } from "./Skeleton";

/*
 * A group of a settings page: a tray with the group's `SectionHeader` (its
 * title, an optional description and an `extra` at its end: a count, a small
 * button), and an inner panel lifted 3px inside it holding the group's
 * content, which runs to the panel's edges: `SettingsRow`s or a table.
 *
 * `SettingsRow` is one setting in the panel: its label, with an optional
 * line of description under it, and its control in a column at the end of
 * the row at least 240px or a third of the row wide. `SettingsValueRow` is
 * one fact about the reader: its label in a 160px column, the value right
 * after it and an `action` at the row's end. Rows are ruled apart.
 */
export function SettingsGroup({
  children,
  description,
  extra,
  id,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  /** Makes the group a link target. */
  id?: string;
  title: string;
}) {
  return (
    <section className="ui-settings-group" id={id}>
      <div className="ui-settings-group-header">
        <SectionHeader title={title} description={description} extra={extra} />
      </div>
      <div className="ui-settings-group-panel">{children}</div>
    </section>
  );
}

export function SettingsRow({
  children,
  description,
  label,
}: {
  /** The setting's value or the control that changes it. */
  children?: ReactNode;
  description?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="ui-settings-row">
      <div className="ui-settings-row-label">
        <span className="ui-settings-row-title">{label}</span>
        {description != null ? (
          <small className="ui-settings-row-description">{description}</small>
        ) : null}
      </div>
      {children != null ? (
        <div className="ui-settings-row-control">{children}</div>
      ) : null}
    </div>
  );
}

export function SettingsValueRow({
  action,
  children,
  label,
}: {
  action?: ReactNode;
  children?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="ui-settings-row ui-settings-value-row">
      <span className="ui-settings-value-row-label">{label}</span>
      <div className="ui-settings-value-row-body">
        {children != null ? (
          <span className="ui-settings-value-row-value">{children}</span>
        ) : null}
        {action != null ? (
          <div className="ui-settings-value-row-action">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A `SettingsGroup` while it loads: the heading's bone over the panel's
 * content in its own shape (a `TableSkeleton`), or over `rows` setting rows.
 */
export function SettingsGroupSkeleton({
  children,
  rows = 2,
}: {
  children?: ReactNode;
  rows?: number;
}) {
  return (
    <div aria-hidden className="ui-settings-group">
      <div className="ui-settings-group-header">
        <Skeleton.Text size="lg" width="8em" />
      </div>
      <div className="ui-settings-group-panel">
        {children ??
          Array.from({ length: rows }, (_, index) => (
            <div className="ui-settings-row" key={index}>
              <div className="ui-settings-row-label">
                <Skeleton.Text width="5em" />
              </div>
              <div className="ui-settings-row-control">
                <Skeleton.Text width="10em" />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
