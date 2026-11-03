import { Play } from "lucide-react";

import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Tooltip } from "../../ui/kit/Tooltip";

/** Opens the training dialog, or says in a tooltip why a run cannot start. */
export function TrainButton({
  refusal,
  onClick,
}: {
  refusal: string | null;
  onClick: () => void;
}) {
  return (
    <Tooltip title={refusal}>
      <Button
        type="primary"
        icon={Play}
        disabled={refusal !== null}
        onClick={onClick}
      >
        {m.training_button()}
      </Button>
    </Tooltip>
  );
}
