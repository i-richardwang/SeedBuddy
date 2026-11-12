import { useSyncExternalStore } from "react";

/*
 * The reader's color scheme: `system` follows the operating system, `light`
 * and `dark` hold one scheme. The choice lives in this browser's storage; the
 * page shows it by the `dark` class on the root element, set before the
 * first paint by `COLOR_SCHEME_SCRIPT` and again whenever the choice or the
 * system preference changes.
 */

export type ColorScheme = "system" | "light" | "dark";

const KEY = "seedbuddy-color-scheme";
const QUERY = "(prefers-color-scheme: dark)";

/** Runs in the document head: applies the stored choice and follows the system while it is `system`. */
export const COLOR_SCHEME_SCRIPT = `(()=>{try{const q=matchMedia(${JSON.stringify(QUERY)}),a=()=>{let s=null;try{s=localStorage.getItem(${JSON.stringify(KEY)})}catch(e){}document.documentElement.classList.toggle("dark",s==="dark"||(s!=="light"&&q.matches))};a();q.addEventListener("change",a);addEventListener("storage",a)}catch(e){}})()`;

const listeners = new Set<() => void>();

function read(): ColorScheme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setColorScheme(scheme: ColorScheme) {
  try {
    if (scheme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, scheme);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  const root = document.documentElement;
  // Held for one frame, so every element takes its new colors together.
  root.classList.add("scheme-changing");
  root.classList.toggle(
    "dark",
    scheme === "dark" || (scheme === "system" && matchMedia(QUERY).matches),
  );
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove("scheme-changing")),
  );
  for (const listener of listeners) listener();
}

/** The stored choice; `system` while rendering on the server. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, read, () => "system");
}
