import type { VersionComparisonDetail } from "../../domain/models/read-model";
import { findVersionComparisons } from "./find-version-comparisons";
/** One candidate's comparison, image by image, or null when it has none. */
export async function versionComparisonDetail(
  modelId: string,
  versionId: string,
): Promise<VersionComparisonDetail | null> {
  return (
    (await findVersionComparisons(modelId, { version: versionId })).get(
      versionId,
    ) ?? null
  );
}
