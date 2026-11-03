import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { type ReactNode, useState } from "react";

import { SignedInUser } from "../features/account/SignedInUser";
import { getExperimentNames } from "../functions/experiments";
import { getSession } from "../functions/session";
import { m } from "../paraglide/messages";
import { errorMessage } from "../ui/errors";
import { useRefreshOnReturn } from "../ui/hooks/useRouteRefresh";
import { RouteNotice } from "../ui/RouteNotice";
import { Shell } from "../ui/shell/Shell";

/** Remember which of the shell's side panels are folded. The server reads them so the first frame matches. */
const NAV_COOKIE = "vitroflow_nav";
const INSPECTOR_COOKIE = "vitroflow_inspector";

const readCollapsed = createIsomorphicFn()
  .server((cookie: string) => getCookie(cookie) === "collapsed")
  .client((cookie: string) =>
    document.cookie.split("; ").includes(`${cookie}=collapsed`),
  );

function writeCollapsed(cookie: string, collapsed: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the next request's server render reads it, so the write is synchronous
  document.cookie = `${cookie}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The signed-in account and the experiments in the navigation are loaded on
 * entering the workbench and kept while the reader moves between its pages;
 * they are read again whenever the route's data is.
 */
export const Route = createFileRoute("/_workbench")({
  beforeLoad: () => ({
    navCollapsed: readCollapsed(NAV_COOKIE),
    inspectorCollapsed: readCollapsed(INSPECTOR_COOKIE),
  }),
  loader: async () => {
    const [{ user }, experiments] = await Promise.all([
      getSession(),
      getExperimentNames(),
    ]);
    return { user, experiments };
  },
  component: WorkbenchLayout,
  notFoundComponent: WorkbenchNotFound,
  errorComponent: WorkbenchError,
});

function WorkbenchLayout() {
  return (
    <WorkbenchShell>
      <Outlet />
    </WorkbenchShell>
  );
}

function WorkbenchNotFound() {
  return (
    <WorkbenchShell>
      <RouteNotice title={m.not_found()} />
    </WorkbenchShell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  return (
    <WorkbenchShell>
      <RouteNotice
        title={m.something_went_wrong()}
        description={errorMessage(error)}
      />
    </WorkbenchShell>
  );
}

/** The shell around a page, or the page alone when the workbench's own data could not be loaded. */
function WorkbenchShell({ children }: { children: ReactNode }) {
  const { navCollapsed, inspectorCollapsed } = Route.useRouteContext();
  const workbench = Route.useMatch({ select: (match) => match.loaderData });
  const [collapsed, setCollapsed] = useState(navCollapsed);
  const [inspectorFolded, setInspectorFolded] = useState(inspectorCollapsed);
  useRefreshOnReturn();
  if (!workbench) return children;
  const { user, experiments } = workbench;
  return (
    <Shell
      user={user}
      account={<SignedInUser user={user} />}
      experiments={experiments}
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        setCollapsed(next);
        writeCollapsed(NAV_COOKIE, next);
      }}
      inspectorCollapsed={inspectorFolded}
      onInspectorCollapsedChange={(next) => {
        setInspectorFolded(next);
        writeCollapsed(INSPECTOR_COOKIE, next);
      }}
    >
      {children}
    </Shell>
  );
}
