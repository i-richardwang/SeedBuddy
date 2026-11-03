import { and, eq } from "drizzle-orm";

import { AnnotationConflictError } from "../../domain/annotation/errors";
import {
  type AnnotationDocument,
  type AnnotationInstance,
  type AnnotationRef,
  annotationSchema,
} from "../../domain/annotation/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { canonicalJson } from "../../lib/json/canonical";
import { lockImage } from "../images/public";
import { database, type Executor, transaction } from "../infra/db/client";
import { annotations, images } from "../infra/db/schema";
import { readModel } from "../models/public";

/** The image's stored review for the model, if a person has made one. */
export async function readAnnotation(
  ref: AnnotationRef,
  executor?: Executor,
): Promise<AnnotationDocument | null> {
  const db = executor ?? (await database());
  const [row] = await db
    .select({ document: annotations.document })
    .from(annotations)
    .where(
      and(
        eq(annotations.imageId, ref.digest),
        eq(annotations.modelId, ref.modelId),
      ),
    );
  return row?.document ?? null;
}

/**
 * Stores the instances a reviewer decided on as the image's review for the model.
 * The document is composed here, on the stored image, so a review can only
 * ever describe the image it is addressed to. The base is those stored
 * instances at open, or null for a first review. Only that base can be replaced.
 */
export async function storeAnnotation(
  ref: AnnotationRef,
  instances: AnnotationInstance[],
  base: AnnotationInstance[] | null,
): Promise<AnnotationDocument> {
  return transaction(async (tx) => {
    await lockImage(ref.digest, tx);
    const current = await readAnnotation(ref, tx);
    if (canonicalJson(current?.instances ?? null) !== canonicalJson(base)) {
      throw new AnnotationConflictError();
    }
    const [image] = await tx
      .select({ width: images.width, height: images.height })
      .from(images)
      .where(eq(images.id, ref.digest));
    if (!image) throw new Error(`Image ${ref.digest} is not stored`);
    const model = await readModel(ref.modelId, tx);
    if (!model) throw new Error(`Unknown model: ${ref.modelId}`);
    const document = annotationSchema.parse({
      schemaVersion: 1,
      image: { digest: ref.digest, ...image },
      instances,
    });
    assertInstanceClasses(model.classes, document.instances, "Annotation");
    const updatedAt = new Date();
    await tx
      .insert(annotations)
      .values({
        imageId: ref.digest,
        modelId: ref.modelId,
        document,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [annotations.imageId, annotations.modelId],
        set: { document, updatedAt },
      });
    return document;
  });
}
