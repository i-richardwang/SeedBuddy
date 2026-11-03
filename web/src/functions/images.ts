import { createServerFn } from "@tanstack/react-start";

import { imageRefSchema } from "../domain/images/schema";
import { clearImageUnclear, markImageUnclear } from "../server/images/public";

/** Marks a photograph unclear, saved on its own, apart from the image's review. */
export const createUnclearMark = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => markImageUnclear(data));

/** Clears a photograph's mark, so that it reads as clear again. */
export const removeUnclearMark = createServerFn({ method: "POST" })
  .validator(imageRefSchema)
  .handler(({ data }) => clearImageUnclear(data));
