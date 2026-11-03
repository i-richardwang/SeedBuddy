import type { VersionComparisonDetail } from "../../domain/models/read-model";
import { snapshot } from "../infra/db/client";
import { findVersionComparisons } from "./find-version-comparisons";

/** One candidate's comparison, image by image, or null when it has none. */
export async function versionComparisonDetail(
  modelId: string,
  versionId: string,
): Promise<VersionComparisonDetail | null> {
  return snapshot(
    async (db) =>
      (await findVersionComparisons(modelId, versionId, db)).get(versionId) ??
      null,
  );
}
