import { useSyncExternalStore } from "react";

interface MediaQueryStore {
  /** False while no browser is present. */
  matches: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

/*
 * One store per query, created on first use. The query is resolved lazily so
 * that a breakpoint read from the stylesheet is read once styles exist.
 */
function createMediaQueryStore(resolveQuery: () => string): MediaQueryStore {
  let list: MediaQueryList | undefined;
  const get = () => {
    if (list || typeof window === "undefined") return list;
    const query = resolveQuery();
    if (query) list = window.matchMedia(query);
    return list;
  };

  return {
    matches: () => get()?.matches ?? false,
    subscribe: (listener) => {
      const target = get();
      target?.addEventListener("change", listener);
      return () => target?.removeEventListener("change", listener);
    },
  };
}

export const prefersReducedMotion = createMediaQueryStore(
  () => "(prefers-reduced-motion: reduce)",
);

/*
 * Below the `--breakpoint-laptop` width in `app.css`, the same width the
 * stylesheets use through the `max-laptop` variant.
 */
const belowLaptop = createMediaQueryStore(() => {
  const width = getComputedStyle(document.documentElement)
    .getPropertyValue("--breakpoint-laptop")
    .trim();
  return width ? `(width < ${width})` : "";
});

/*
 * Server snapshot is `false`, so the server HTML and the first client frame
 * agree and the real value arrives in the render after hydration.
 */
function useMediaQuery(store: MediaQueryStore) {
  return useSyncExternalStore(store.subscribe, store.matches, () => false);
}

/** Tablet and below: the width where the fixed sidebar becomes a drawer. */
export function useIsCompact() {
  return useMediaQuery(belowLaptop);
}
