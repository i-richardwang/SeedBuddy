import { Link2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";

/*
 * The frame of the pages outside the signed-in shell: one bordered surface
 * inset 8px from the viewport, the brand in its top row, a bottom bar for
 * page-wide controls such as the language, and the content bare in the
 * middle. The content is a heading, the page's body with 32px above and
 * below it, and then its `actions`; a `hero` such as an `AuthConnection`
 * goes 16px above the heading. `centered` narrows the column to 400px and
 * centers the heading, for a question put to the reader. The frame scrolls
 * itself when the content is taller than the viewport.
 */
export function AuthLayout({
  actions,
  brand,
  centered,
  children,
  description,
  footer,
  hero,
  title,
}: {
  actions?: ReactNode;
  brand: ReactNode;
  centered?: boolean;
  children?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  hero?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="ui-auth-layout">
      <div className="ui-auth-layout-frame">
        <header className="ui-auth-layout-header">{brand}</header>
        <main className="ui-auth-layout-main">
          <div
            className={cn(
              "ui-auth-layout-content",
              centered && "ui-auth-layout-content-centered",
            )}
          >
            {hero}
            <div className="ui-auth-layout-card">
              <div className="ui-auth-layout-heading">
                <h1 className="ui-auth-layout-title">{title}</h1>
                {description ? (
                  <div className="ui-auth-layout-description">
                    {description}
                  </div>
                ) : null}
              </div>
              <div className="ui-auth-layout-body">{children}</div>
              {actions ? (
                <div className="ui-auth-layout-actions">{actions}</div>
              ) : null}
            </div>
          </div>
        </main>
        {footer ? (
          <footer className="ui-auth-layout-footer">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Who is asking and what they ask to reach: the client's icon and the
 * product's mark in two tiles, joined by a link.
 */
export function AuthConnection({
  client,
  product,
}: {
  client: IconProps["icon"];
  product: ReactNode;
}) {
  return (
    <div aria-hidden className="ui-auth-connection">
      <span className="ui-auth-connection-tile">
        <Icon icon={client} size={28} strokeWidth={1.5} />
      </span>
      <span className="ui-auth-connection-line" />
      <Icon className="ui-auth-connection-link" icon={Link2} size={20} />
      <span className="ui-auth-connection-line" />
      <span className="ui-auth-connection-tile">{product}</span>
    </div>
  );
}

/** A divider between the page-wide controls in the footer. */
export function AuthLayoutSeparator() {
  return <span aria-hidden className="ui-auth-layout-separator" />;
}
