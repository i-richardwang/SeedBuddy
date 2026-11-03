import { useState } from "react";

const PAGE_SIZE = 20;

/** Search and filter a table, starting at its first page whenever either changes. */
export function usePagedSearch<T, F = undefined>(
  items: readonly T[],
  options: {
    text: (item: T) => string;
    initialFilter?: F;
    accepts?: (item: T, filter: F) => boolean;
  },
) {
  const [query, changeQuery] = useState("");
  const [filter, changeFilter] = useState<F>(options.initialFilter as F);
  const [page, setPage] = useState(1);
  const needle = query.trim().toLowerCase();
  const matches = items.filter(
    (item) =>
      options.text(item).toLowerCase().includes(needle) &&
      (options.accepts?.(item, filter) ?? true),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return {
    query,
    setQuery: (next: string) => {
      changeQuery(next);
      setPage(1);
    },
    filter,
    setFilter: (next: F) => {
      changeFilter(next);
      setPage(1);
    },
    matches,
    shown: matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    pagination:
      matches.length > PAGE_SIZE
        ? {
            current,
            pageSize: PAGE_SIZE,
            total: matches.length,
            onChange: setPage,
          }
        : null,
  };
}
