/// <reference types="vite/client" />

import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import appCss from "../styles/app.css?url";
import { COLOR_SCHEME_SCRIPT } from "../ui/colorScheme";
import { documentTitle } from "../ui/documentTitle";
import { ModalHost } from "../ui/kit/Modal";
import { Toaster } from "../ui/kit/Toast";
import { TooltipGroup } from "../ui/kit/Tooltip";
import { RouteNotice } from "../ui/RouteNotice";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: documentTitle() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  return (
    <RootDocument>
      <TooltipGroup layoutAnimation={false}>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </TooltipGroup>
      <Toaster />
      <ModalHost />
    </RootDocument>
  );
}

function NotFoundPage() {
  return <RouteNotice title={m.not_found()} />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that sets the color scheme before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
