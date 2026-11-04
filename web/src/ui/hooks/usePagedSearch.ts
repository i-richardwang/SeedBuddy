import { useState } from "react";

const PAGE_SIZE = 20;

type SearchOptions<T, F> = {
  text: (item: T) => string;
  initialFilter: F;
  accepts?: (item: T, filter: F) => boolean;
};

type PagedSearch<T, F> = {
  query: string;
  setQuery: (query: string) => void;
  filter: F;
  setFilter: (filter: F) => void;
  matches: T[];
  shown: T[];
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  } | null;
};

export function usePagedSearch<T>(
  items: readonly T[],
  options: Pick<SearchOptions<T, undefined>, "text">,
): PagedSearch<T, undefined>;
export function usePagedSearch<T, F>(
  items: readonly T[],
  options: SearchOptions<T, F>,
): PagedSearch<T, F>;
/** Search and filter a table, starting at its first page whenever either changes. */
export function usePagedSearch<T, F>(
  items: readonly T[],
  options: SearchOptions<T, F> | { text: (item: T) => string },
) {
  const [query, changeQuery] = useState("");
  const [selection, changeFilter] = useState(() =>
    "initialFilter" in options ? { value: options.initialFilter } : undefined,
  );
  const [page, setPage] = useState(1);
  const needle = query.trim().toLowerCase();
  const matches = items.filter(
    (item) =>
      options.text(item).toLowerCase().includes(needle) &&
      (!selection ||
        !("accepts" in options) ||
        (options.accepts?.(item, selection.value) ?? true)),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return {
    query,
    setQuery: (next: string) => {
      changeQuery(next);
      setPage(1);
    },
    filter: selection?.value,
    setFilter: (next: F) => {
      changeFilter({ value: next });
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
