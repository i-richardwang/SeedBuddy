import { m } from "../paraglide/messages";

/**
 * What a read found. A server function answers `null` for something that
 * is not there; this turns that answer into the failure to report.
 */
export function found<T>(read: T | null): T {
  if (read === null) throw new Error(m.error_not_found());
  return read;
}
