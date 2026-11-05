import { useMatches } from "@tanstack/react-router";

export type Crumb = { label: string; href?: string };

/** The way down to the current page, from the deepest route that declares `staticData.crumbs`. */
export function useCrumbs(): Crumb[] {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const spec = match.staticData.crumbs;
    if (!spec || match.status !== "success") continue;
    return spec({
      loaderData: match.loaderData,
      params: match.params as Record<string, string>,
      search: match.search as Record<string, unknown>,
    });
  }
  return [];
}
