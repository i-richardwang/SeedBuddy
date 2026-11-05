import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Reloads the current route's data every `intervalMs` while the tab is visible
 * and `enabled` holds. A tick that falls while the router is loading, a
 * reload still under way or the way to another page, is skipped: reloading
 * then would begin that load again.
 */
export function useRouteRefresh(intervalMs: number, enabled = true): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || router.state.isLoading) {
        return;
      }
      void router.invalidate();
    };
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);
}

/**
 * Asks `probe` every `intervalMs` while the tab is visible and `enabled`
 * holds, and reloads the current route's data only once the answer differs
 * from `current`, what the data on show says: a page watching something
 * change asks a small question instead of reading itself again. Answers are
 * plain values, compared as they are. A tick that falls while the last
 * question is unanswered is skipped; a failed probe is asked again at the
 * next tick.
 */
export function useRefreshOnChange<T extends string | number | boolean | null>(
  probe: () => Promise<T>,
  current: T,
  intervalMs: number,
  enabled = true,
): void {
  const router = useRouter();
  const asking = useRef(false);
  // Read when the answer comes, against the data on show by then.
  const changed = useEffectEvent((answer: T) => answer !== current);
  const ask = useEffectEvent(async () => {
    if (
      asking.current ||
      document.visibilityState !== "visible" ||
      router.state.isLoading
    ) {
      return;
    }
    asking.current = true;
    let answer: T;
    try {
      answer = await probe();
    } catch {
      return;
    } finally {
      asking.current = false;
    }
    if (changed(answer) && !router.state.isLoading) {
      void router.invalidate();
    }
  });
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void ask(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}

const RETURN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Reloads the current route's data when the reader comes back to a tab left
 * for five minutes or more, so what they return to is not what they left.
 */
export function useRefreshOnReturn(): void {
  const router = useRouter();
  useEffect(() => {
    let leftAt: number | null = null;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        leftAt = Date.now();
        return;
      }
      if (leftAt !== null && Date.now() - leftAt >= RETURN_INTERVAL_MS) {
        void router.invalidate();
      }
      leftAt = null;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [router]);
}
