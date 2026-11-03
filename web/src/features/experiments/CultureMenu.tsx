import { ChevronDown, CircleMinus, ClipboardPen } from "lucide-react";
import { useState } from "react";

import {
  latestCultureEvent,
  observationOrdinals,
} from "../../domain/experiments/culture-events";
import type { Unit } from "../../domain/experiments/read-model";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { removeCultureEvent } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Button } from "../../ui/kit/Button";
import { type DropdownItem, DropdownMenu } from "../../ui/kit/DropdownMenu";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { cultureEventLabel, observationLabel } from "./labels";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";

/**
 * The unit's culture status, as a menu of what changes it: recording an
 * event, or taking one back.
 */
const REMOVE_EVENT_FORM = "remove-culture-event";

export function CultureMenu({
  experiment,
  unit,
  observations,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
}) {
  const latest = latestCultureEvent(
    unit.events,
    observationOrdinals(observations),
  );
  const status = latest ? cultureEventLabel(latest.type) : m.active_label();
  const [open, setOpen] = useState<"record" | "remove" | null>(null);
  const close = () => setOpen(null);
  const items: DropdownItem[] = [];
  if (observations.length > 0) {
    items.push({
      key: "record",
      icon: ClipboardPen,
      label: m.culture_event_menu_record(),
      onClick: () => setOpen("record"),
    });
  }
  if (unit.events.length > 0) {
    items.push({
      key: "remove",
      icon: CircleMinus,
      label: m.culture_event_menu_remove(),
      onClick: () => setOpen("remove"),
    });
  }
  if (items.length === 0)
    return (
      <Text as="span" size="sm">
        {status}
      </Text>
    );
  return (
    <>
      <DropdownMenu items={items} align="end">
        <Button size="small" type="text" icon={ChevronDown} iconPosition="end">
          {status}
        </Button>
      </DropdownMenu>
      <RecordCultureEventDialog
        experiment={experiment}
        units={[unit]}
        observations={observations}
        open={open === "record"}
        onClose={close}
      />
      <RemoveCultureEventDialog
        experiment={experiment}
        unit={unit}
        observations={observations}
        open={open === "remove"}
        onClose={close}
      />
    </>
  );
}

function RemoveCultureEventDialog({
  experiment,
  unit,
  observations,
  open,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.culture_event_remove()}
      okText={m.remove_action()}
      formId={REMOVE_EVENT_FORM}
      busy={action.busy}
      danger
    >
      <RemoveCultureEventForm
        experiment={experiment}
        unit={unit}
        observations={observations}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

/** Proposes the unit's latest status. */
function RemoveCultureEventForm({
  experiment,
  unit,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const { events } = unit;
  const [event, setEvent] = useState(events.at(-1)?.id ?? "");
  const describe = (item: (typeof events)[number]) => {
    const observation = observations.find(
      (entry) => entry.id === item.observation,
    );
    return observation
      ? m.culture_event_at({
          event: cultureEventLabel(item.type),
          observation: observationLabel(observation),
        })
      : cultureEventLabel(item.type);
  };

  return (
    <Form
      id={REMOVE_EVENT_FORM}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        const removed = events.find((item) => item.id === event);
        if (!removed) return;
        void action.run(
          () => removeCultureEvent({ data: { experiment, event } }),
          m.culture_event_not_removed(),
          {
            onSuccess: () => {
              toast.success(
                m.culture_event_removed({ event: describe(removed) }),
              );
              onDone();
            },
          },
        );
      }}
    >
      <Form.Field label={m.status_label()} required>
        <Select
          disabled={action.busy}
          options={events.map((item) => ({
            label: describe(item),
            value: item.id,
          }))}
          value={event}
          onChange={setEvent}
        />
      </Form.Field>
    </Form>
  );
}
