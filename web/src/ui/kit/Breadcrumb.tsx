import type { ReactElement, ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { OverflowTooltip } from "./Tooltip";

export interface BreadcrumbItem {
  href?: string;
  label: string;
}

export interface BreadcrumbLinkProps {
  children: ReactNode;
  className: string;
  href: string;
}

/** The trail to the page; a phone shows the page's own crumb alone. */
export function Breadcrumb({
  items,
  renderLink,
}: {
  items: BreadcrumbItem[];
  /** Renders each ancestor link, for example as a router link. */
  renderLink: (props: BreadcrumbLinkProps) => ReactElement;
}) {
  return (
    <nav aria-label={m.ui_breadcrumb_label()} className="ui-breadcrumb">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const crumb =
          item.href && !last ? (
            renderLink({
              children: item.label,
              className: "ui-breadcrumb-link",
              href: item.href,
            })
          ) : (
            <span
              aria-current={last ? "page" : undefined}
              className={last ? "ui-breadcrumb-page" : "ui-breadcrumb-ancestor"}
            >
              {item.label}
            </span>
          );
        return (
          <span key={`${index}`}>
            <OverflowTooltip placement="bottom" title={item.label}>
              {crumb}
            </OverflowTooltip>

            {index < items.length - 1 ? (
              <span aria-hidden className="ui-breadcrumb-separator">
                /
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
