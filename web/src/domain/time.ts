import { z } from "zod";

/** An ISO 8601 instant with UTC Z or an explicit offset. */
export const timestampSchema = z.iso.datetime({ offset: true });
