import type { ReactNode } from "react";

/*
 * The heading of a part of a page, the same wherever a page is divided: a
 * document's sections, a settings page's groups, a workbench inspector's
 * sections. `default` is 16px at 600 with an `extra` at the row's end (a count, a small button);
 * `compact`, for a side panel or a group inside a section, is 12px at 600 in
 * the tertiary color. `level` 3 heads a part nested in a section.
 */
export function SectionHeader({
  extra,
  level = 2,
  size = "default",
  title,
}: {
  extra?: ReactNode;
  level?: 2 | 3;
  size?: "default" | "compact";
  title: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <header className="ui-section-header" data-size={size}>
      <div className="ui-section-header-copy">
        <Heading className="ui-section-header-title">{title}</Heading>
      </div>
      {extra != null ? (
        <div className="ui-section-header-extra">{extra}</div>
      ) : null}
    </header>
  );
}
