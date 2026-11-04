import type { ReactNode } from "react";

import type { IconProps } from "./Icon";
import { IconTile } from "./IconTile";

/*
 * The title block at the top of a page's content, with the page's commands
 * at its end: a 24px title followed by the page's `status`, a line of
 * `description`, and a line of `meta` facts (13px, tertiary). A page about
 * one thing sets its `icon`, which stands on a 40px tile before the title
 * block, the same mark its card carries in the list.
 */
export function PageHeader({
  actions,
  description,
  icon,
  meta,
  status,
  title,
}: {
  /** At most one primary button, then a menu. */
  actions?: ReactNode;
  description?: ReactNode;
  icon?: IconProps["icon"];
  meta?: ReactNode[];
  status?: ReactNode;
  title: ReactNode;
}) {
  const main = (
    <div className="ui-page-header-main">
      <div className="ui-page-header-heading">
        <h1 className="ui-page-header-title">{title}</h1>
        {status}
      </div>
      {description ? (
        <div className="ui-page-header-description">{description}</div>
      ) : null}
      {meta?.length ? (
        <ul className="ui-page-header-meta">
          {meta.map((item, index) => (
            <li className="ui-page-header-meta-item" key={index}>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  return (
    <div className="ui-page-header">
      {icon ? (
        <div className="ui-page-header-identity">
          <IconTile icon={icon} />
          {main}
        </div>
      ) : (
        main
      )}
      {actions != null ? (
        <div className="ui-page-header-actions">{actions}</div>
      ) : null}
    </div>
  );
}
