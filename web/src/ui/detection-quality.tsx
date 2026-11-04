import { Alert } from "./kit/Alert";
import { Flexbox } from "./kit/Flex";
import { Tag } from "./kit/Tag";
import { formatList } from "./lists";

export function QualityTags({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) {
    return null;
  }
  return (
    <Flexbox horizontal gap={4} wrap="wrap">
      {labels.map((label) => (
        <Tag key={label} color="warning" size="small">
          {label}
        </Tag>
      ))}
    </Flexbox>
  );
}

export function QualityAlert({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) {
    return null;
  }
  return <Alert type="warning" title={formatList(labels)} />;
}
