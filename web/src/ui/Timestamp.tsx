import { getLocale } from "../paraglide/runtime";
import { useClientValue } from "./kit/clientValue";

const UTC = "UTC";

/**
 * An instant in the locale's notation, in `timeZone`. Read in UTC it names
 * the zone; in the reader's own zone it is simply their clock.
 */
export function formatTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone === UTC ? "short" : undefined,
  }).format(new Date(value));
}

/**
 * An instant on the reader's clock. The server knows no reader's zone, so
 * the server and the first client frame write it in UTC and the browser's
 * own zone replaces it after hydration.
 */
export function Timestamp({ value }: { value: string }) {
  const timeZone = useClientValue(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    UTC,
  );
  return <time dateTime={value}>{formatTimestamp(value, timeZone)}</time>;
}
