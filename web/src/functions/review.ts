import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
} from "../domain/annotation/schema";
import { storeAnnotation } from "../server/annotations/public";

export const updateAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({
      ref: annotationRefSchema,
      instances: z.array(annotationInstanceSchema),
      base: z.array(annotationInstanceSchema).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await storeAnnotation(data.ref, data.instances, data.base);
    return { status: "saved" } as const;
  });
