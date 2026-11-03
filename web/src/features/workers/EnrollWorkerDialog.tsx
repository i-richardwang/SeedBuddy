import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { RESOURCE_ID_PATTERN } from "../../domain/identifiers/schema";
import { addWorker } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { CopyableCode } from "../../ui/CopyableCode";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { RevealOnceDialog } from "../../ui/RevealOnceDialog";

const FORM_ID = "enroll-worker";

/** What the machine needs: its setup command and the token it connects with. */
interface Enrollment {
  command: string;
  token: string;
}

/**
 * An administrator names a machine. Once enrolled, the form closes and the
 * setup command and token are shown, the only time the token is visible; the
 * worker list refreshes when that closes.
 */
export function EnrollWorkerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const action = useAsyncAction();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  return (
    <>
      <FormDialog
        open={open}
        onClose={onClose}
        title={m.worker_enroll_title()}
        okText={m.worker_enroll_create()}
        formId={FORM_ID}
        busy={action.busy}
      >
        <EnrollWorkerForm
          action={action}
          onEnrolled={(next) => {
            onClose();
            setEnrollment(next);
          }}
        />
      </FormDialog>
      <RevealOnceDialog
        revealed={enrollment}
        title={m.worker_enroll_ready()}
        hint={m.worker_enroll_shown_once()}
        onClose={() => {
          setEnrollment(null);
          void router.invalidate();
        }}
      >
        {({ command, token }) => (
          <>
            <CopyableCode
              value={command}
              label={m.worker_enroll_command_label()}
              description={m.worker_enroll_command_description()}
            />
            <CopyableCode value={token} label={m.worker_enroll_token_label()} />
          </>
        )}
      </RevealOnceDialog>
    </>
  );
}

function EnrollWorkerForm({
  action: { busy, run },
  onEnrolled,
}: {
  action: AsyncAction;
  onEnrolled: (enrollment: Enrollment) => void;
}) {
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          () =>
            addWorker({
              data: { workerId: String(form.get("workerId") ?? "") },
            }),
          m.worker_enroll_failed(),
          {
            invalidate: false,
            onSuccess: ({ workerId, token }) => {
              onEnrolled({
                command: `vitroctl worker setup ${workerId} --server ${window.location.origin}`,
                token,
              });
            },
          },
        );
      }}
    >
      <Form.Field
        label={m.worker_enroll_name_label()}
        desc={m.worker_enroll_name_description()}
        name="workerId"
        required
      >
        <Input
          name="workerId"
          autoComplete="off"
          autoFocus
          disabled={busy}
          pattern={RESOURCE_ID_PATTERN}
          placeholder={m.worker_enroll_name_placeholder()}
        />
      </Form.Field>
    </Form>
  );
}
