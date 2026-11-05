import { ChevronLeft, ChevronRight } from "lucide-react";

import { m } from "../../paraglide/messages";
import { Icon } from "./Icon";
import { Select } from "./Select";

/**
 * Whether a list's pagination shows anything: page buttons while the list
 * fills more than a page, and, given `pageSizes`, the picker while it holds
 * more than the smallest page would.
 */
export function paginates({
  pageSize,
  total,
  pageSizes,
}: {
  pageSize: number;
  total: number;
  pageSizes?: readonly number[];
}): boolean {
  return total > Math.min(...(pageSizes ?? []), pageSize);
}

/**
 * Small page buttons at the foot of a list: the step back, the first and
 * last pages, the pages around the current one with a gap where pages are
 * left out, and the step forward. The current page is outlined in the
 * primary color. Given `pageSizes`, a picker of how many rows a page holds
 * follows the buttons. A list shows it where `paginates` says it has
 * anything to show.
 */
export function Pagination({
  current,
  pageSize,
  total,
  onChange,
  pageSizes,
  onPageSizeChange,
}: {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
} & (
  | { pageSizes?: undefined; onPageSizeChange?: undefined }
  | {
      pageSizes: readonly number[];
      onPageSizeChange: (pageSize: number) => void;
    }
)) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label={m.ui_pagination()} className="ui-pagination">
      {last > 1 ? (
        <>
          <button
            aria-label={m.ui_pagination_previous()}
            className="ui-pagination-item"
            disabled={current <= 1}
            type="button"
            onClick={() => onChange(current - 1)}
          >
            <Icon icon={ChevronLeft} size={14} />
          </button>
          {pages(current, last).map((page) =>
            typeof page === "string" ? (
              <span aria-hidden className="ui-pagination-gap" key={page}>
                …
              </span>
            ) : (
              <button
                aria-current={page === current ? "page" : undefined}
                aria-label={m.ui_pagination_page({ page })}
                className="ui-pagination-item"
                key={page}
                type="button"
                onClick={() => onChange(page)}
              >
                {page}
              </button>
            ),
          )}
          <button
            aria-label={m.ui_pagination_next()}
            className="ui-pagination-item"
            disabled={current >= last}
            type="button"
            onClick={() => onChange(current + 1)}
          >
            <Icon icon={ChevronRight} size={14} />
          </button>
        </>
      ) : null}
      {pageSizes ? (
        <Select
          aria-label={m.ui_pagination_page_size()}
          className="ui-pagination-size"
          options={pageSizes.map((size) => ({
            value: size,
            label: m.ui_pagination_page_size_option({ size }),
          }))}
          size="small"
          value={pageSize}
          onChange={onPageSizeChange}
        />
      ) : null}
    </nav>
  );
}

/**
 * The pages to show: the ends, and two on each side of `current`. A run left
 * out is a string naming the page it follows.
 */
function pages(current: number, last: number): (number | string)[] {
  const shown = new Set([1, last]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page > 1 && page < last) shown.add(page);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((page, index) => {
    const before = sorted[index - 1];
    return before !== undefined && page - before > 1
      ? [`after-${before}`, page]
      : [page];
  });
}
