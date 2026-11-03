import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  annotationInstanceSchema,
  annotationRefSchema,
} from "../domain/annotation/schema";
import {
  AnnotationConflictError,
  storeAnnotation,
} from "../server/annotations/public";

export const updateAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.strictObject({
      ref: annotationRefSchema,
      instances: z.array(annotationInstanceSchema),
      base: z.array(annotationInstanceSchema).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await storeAnnotation(data.ref, data.instances, data.base);
      return { status: "saved" } as const;
    } catch (error) {
      if (error instanceof AnnotationConflictError) {
        return { status: "conflict" } as const;
      }
      throw error;
    }
  });
