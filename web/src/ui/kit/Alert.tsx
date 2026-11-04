import {
  ChevronRight,
  type LucideIcon,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { Snippet } from "./Snippet";

/*
 * An inline notice of a lasting state: a title that states the conclusion, an
 * optional description line under it, and an optional action such as Retry.
 * `detail` holds the raw text behind it, an error message for instance,
 * folded away under a disclosure and copyable when opened. It is a polite
 * live region, so a notice that appears is announced without interrupting.
 */

type AlertType = "warning" | "error";

interface AlertProps {
  /** Placed after the text. */
  action?: ReactNode;
  description?: ReactNode;
  /** Raw text behind the notice, shown on request. */
  detail?: string;
  title: ReactNode;
  type: AlertType;
}

const TONE = {
  error: "ui-alert-tone-error",
  warning: "ui-alert-tone-warning",
} satisfies Record<AlertType, string>;

const TYPE_ICONS = {
  error: XCircle,
  warning: TriangleAlert,
} satisfies Record<AlertType, LucideIcon>;

export function Alert({
  action,
  description,
  detail,
  title,
  type,
}: AlertProps) {
  const hasDescription =
    (description !== undefined && description !== null) || Boolean(detail);
  return (
    <div
      className={cn(
        TONE[type],
        "ui-alert",
        hasDescription ? "ui-alert-detailed" : "ui-alert-centered",
      )}
      role="status"
    >
      <span aria-hidden="true" className="ui-alert-icon">
        <Icon icon={TYPE_ICONS[type]} size={hasDescription ? 18 : 16} />
      </span>
      <div className="ui-alert-content">
        <div className="ui-alert-title">{title}</div>
        {description != null && (
          <div className="ui-alert-description">{description}</div>
        )}
        {detail ? (
          <details className="ui-alert-detail">
            <summary className="ui-alert-detail-summary">
              <Icon
                className="ui-alert-detail-indicator"
                icon={ChevronRight}
                size={12}
              />
              {m.details_label()}
            </summary>
            <Snippet>{detail}</Snippet>
          </details>
        ) : null}
      </div>
      {action && <div className="ui-alert-action">{action}</div>}
    </div>
  );
}
