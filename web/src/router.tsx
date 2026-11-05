import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import type { Crumb } from "./ui/shell/crumbs";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * The way down to this page while it is the deepest
     * match. Evaluated at render, so labels resolve in the request's locale.
     */
    crumbs?: (match: {
      loaderData: unknown;
      params: Record<string, string>;
      search: Record<string, unknown>;
    }) => Crumb[];
  }
}

/*
 * A link starts loading its page when the pointer rests on it or focus
 * reaches it, so most clicks land on data already fetched. A page that is
 * still loading 200ms after the click gives way to its skeleton, which
 * leaves as soon as the data arrives.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingMs: 200,
    defaultPendingMinMs: 0,
  });
}
