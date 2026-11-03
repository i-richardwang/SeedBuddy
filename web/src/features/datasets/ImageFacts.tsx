import type { getDatasetOverview } from "../../functions/datasets";
import { Absent } from "../../ui/Absent";
import { QualityTags } from "../../ui/DetectionQuality";
import { Flexbox } from "../../ui/kit/Flex";
import { Text } from "../../ui/kit/Text";
import { formatCount } from "../../ui/numbers";
import { UnclearTag } from "../images/unclear";

export type DatasetOverviewImage = NonNullable<
  Awaited<ReturnType<typeof getDatasetOverview>>
>["images"][number];

/** Whether anything is said against the image: the detector's warnings, or a person's mark. */
export function hasQualityNotes(image: DatasetOverviewImage): boolean {
  return (
    (image.quality !== null && image.quality.status !== "ok") || image.unclear
  );
}

/** What is said against the image, or nothing. */
export function ImageQuality({ image }: { image: DatasetOverviewImage }) {
  if (!hasQualityNotes(image)) return <Absent />;
  return (
    <Flexbox horizontal gap={4} wrap="wrap">
      {image.unclear ? <UnclearTag /> : null}
      {image.quality && image.quality.status !== "ok" ? (
        <QualityTags quality={image.quality} />
      ) : null}
    </Flexbox>
  );
}

/** A reviewer's count reads plain; an unreviewed proposal or detection reads tertiary. */
export function BoxCount({
  detected,
  proposed,
  boxes,
}: {
  detected: number | null;
  proposed: number | null;
  boxes: number | null;
}) {
  if (boxes !== null) return <>{formatCount(boxes)}</>;
  const unreviewed = proposed ?? detected;
  return unreviewed === null ? (
    <Absent />
  ) : (
    <Text as="span" type="tertiary">
      {formatCount(unreviewed)}
    </Text>
  );
}
