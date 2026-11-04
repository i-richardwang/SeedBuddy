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
import { lockImage, requireStoredImage } from "../images/public";
import { type Executor, operationTime, transaction } from "../infra/db/client";
import { annotations } from "../infra/db/schema";
import { requireModel } from "../models/public";

/** The image's stored review for the model, if a person has made one. */
async function readAnnotation(
  ref: AnnotationRef,
  db: Executor,
): Promise<AnnotationDocument | null> {
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
  return transaction(async (db) => {
    await lockImage(ref.digest, db);
    const current = await readAnnotation(ref, db);
    if (canonicalJson(current?.instances ?? null) !== canonicalJson(base)) {
      throw new AnnotationConflictError();
    }
    const image = await requireStoredImage(ref.digest, db);
    const model = await requireModel(ref.modelId, db);
    const document = annotationSchema.parse({
      schemaVersion: 1,
      image: { digest: ref.digest, width: image.width, height: image.height },
      instances,
    });
    assertInstanceClasses(model.classes, document.instances, "Annotation");
    const updatedAt = await operationTime(db);
    await db
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

/** Insert prevalidated reviews while the caller holds each image lock and has refused existing reviews. */
export async function insertImportedAnnotations(
  modelId: string,
  documents: readonly AnnotationDocument[],
  at: Date,
  db: Executor,
): Promise<void> {
  if (!documents.length) return;
  await db.insert(annotations).values(
    documents.map((document) => ({
      imageId: document.image.digest,
      modelId,
      document,
      updatedAt: at,
    })),
  );
}
