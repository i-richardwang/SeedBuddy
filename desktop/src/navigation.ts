import { fileURLToPath } from "node:url";

/** Where a navigation of the app's window leads. */
export type Destination =
  /** A page of the workbench, which the window shows. */
  | { kind: "workbench" }
  /** The connect page's form, handing over the address typed into it. */
  | { kind: "address"; typed: string }
  /** Another site, which opens in the browser. */
  | { kind: "browser"; url: string }
  /** Anything else, such as a file dropped on the window: it opens nowhere. */
  | { kind: "nowhere" };

/** Whether `url` is one a browser opens. */
export function opensInBrowser(url: string): boolean {
  const protocol = URL.parse(url)?.protocol;
  return protocol === "http:" || protocol === "https:";
}

/**
 * Where a navigation to `target` leads while the app is connected to the
 * workbench at `server`, the connect page being the file at `connectPage`.
 */
export function destination(
  target: string,
  server: string | null,
  connectPage: string,
): Destination {
  const url = URL.parse(target);
  if (url === null) return { kind: "nowhere" };
  if (opensInBrowser(target))
    return url.origin === server
      ? { kind: "workbench" }
      : { kind: "browser", url: target };
  const typed = url.searchParams.get("server");
  return url.protocol === "file:" &&
    url.host === "" &&
    fileURLToPath(url) === connectPage &&
    typed !== null
    ? { kind: "address", typed }
    : { kind: "nowhere" };
}
