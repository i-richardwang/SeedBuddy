import { m } from "../paraglide/messages";

/** Elapsed seconds as a localized age, rounded down to the largest whole unit. */
export function formatAge(seconds: number) {
  if (seconds < 60) return m.relative_time_seconds({ count: seconds });
  if (seconds < 3600) {
    return m.relative_time_minutes({ count: Math.floor(seconds / 60) });
  }
  if (seconds < 86400) {
    return m.relative_time_hours({ count: Math.floor(seconds / 3600) });
  }
  return m.relative_time_days({ count: Math.floor(seconds / 86400) });
}
