import { removeUnclearMark, createUnclearMark } from "../../functions/images";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { Switch } from "../../ui/kit/Switch";
import { Tag } from "../../ui/kit/Tag";
import { WorkbenchSection } from "../../ui/shell/Workbench";

/**
 * Whether the photograph on view could be read clearly, said beside its
 * boxes and saved the moment it changes, apart from the review.
 */
export function UnclearSection({
  digest,
  unclear,
}: {
  digest: string;
  unclear: boolean;
}) {
  const { busy, run } = useAsyncAction();
  const save = async (on: boolean) => {
    const data = { digest };
    await run(async () => {
      if (on) await createUnclearMark({ data });
      else await removeUnclearMark({ data });
    }, m.unclear_not_saved());
  };

  return (
    <WorkbenchSection>
      <Form.Field
        layout="horizontal"
        label={m.unclear_section()}
        desc={m.unclear_switch_description()}
      >
        <Switch
          size="small"
          checked={unclear}
          disabled={busy}
          onChange={(on) => void save(on)}
        />
      </Form.Field>
    </WorkbenchSection>
  );
}

/** That a photograph is marked unclear, stated over it. */
export function UnclearAlert() {
  return <Alert type="warning" title={m.unclear_section()} />;
}

/** That a photograph is marked unclear, in a list beside its other quality tags. */
export function UnclearTag() {
  return (
    <Tag color="warning" size="small">
      {m.unclear_label()}
    </Tag>
  );
}
