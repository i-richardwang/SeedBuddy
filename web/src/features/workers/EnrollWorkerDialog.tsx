import { useState } from "react";

import { RESOURCE_ID_PATTERN } from "../../domain/identifiers/schema";
import { createWorker } from "../../functions/workers";
import { m } from "../../paraglide/messages";
import { CopyableCode } from "../../ui/CopyableCode";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { Text } from "../../ui/kit/Text";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { RevealOnceDialog } from "../../ui/RevealOnceDialog";
import { readWorkerInstallCommand, workerSetupCommand } from "./commands";

const FORM_ID = "enroll-worker";

/**
 * What a computer needs to become the Worker: the command that installs the
 * package this workbench ships, when it ships one, the setup command and the
 * token the Worker connects with.
 */
interface Enrollment {
  install: string | null;
  setup: string;
  token: string;
}

/**
 * An account names a Worker: its own computer, or, for an administrator, one
 * shared by everyone. Once enrolled, the form closes and the commands and
 * token are shown, the only time the token is visible; the Worker list
 * refreshes when that closes.
 */
export function EnrollWorkerDialog({
  administers,
  open,
  onClose,
}: {
  administers: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  return (
    <>
      <FormDialog
        open={open}
        onClose={onClose}
        title={m.worker_enroll()}
        okText={m.worker_enroll_create()}
        formId={FORM_ID}
        busy={action.busy}
      >
        <EnrollWorkerForm
          administers={administers}
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
        }}
      >
        {({ install, setup, token }) => (
          <>
            {install === null ? null : (
              <CopyableCode
                value={install}
                label={m.worker_install_command_label()}
                description={m.worker_install_command_description()}
              />
            )}
            <CopyableCode
              value={setup}
              label={m.worker_enroll_setup_label()}
              description={m.worker_enroll_setup_description()}
            />
            <CopyableCode value={token} label={m.worker_enroll_token_label()} />
          </>
        )}
      </RevealOnceDialog>
    </>
  );
}

function EnrollWorkerForm({
  administers,
  action: { busy, run },
  onEnrolled,
}: {
  administers: boolean;
  action: AsyncAction;
  onEnrolled: (enrollment: Enrollment) => void;
}) {
  const [owner, setOwner] = useState<"shared" | "personal">(
    administers ? "shared" : "personal",
  );
  const description =
    owner === "shared"
      ? m.worker_owner_shared_description()
      : m.worker_owner_personal_description();
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          async () => {
            // Read before enrolling: the token exists only in the answer to
            // the enrollment, so nothing may fail after it.
            const install = await readWorkerInstallCommand();
            const { workerId, token } = await createWorker({
              data: {
                workerId: String(form.get("workerId") ?? ""),
                personal: owner === "personal",
              },
            });
            return { install, setup: workerSetupCommand(workerId), token };
          },
          m.worker_not_enrolled(),
          { invalidate: false, onSuccess: onEnrolled },
        );
      }}
    >
      {administers ? (
        <Form.Field label={m.worker_owner_label()} desc={description} fieldset>
          <ToggleGroup
            aria-label={m.worker_owner_label()}
            value={owner}
            onChange={setOwner}
            options={[
              {
                value: "shared",
                label: m.worker_owner_shared(),
                disabled: busy,
              },
              {
                value: "personal",
                label: m.worker_owner_personal(),
                disabled: busy,
              },
            ]}
          />
        </Form.Field>
      ) : (
        <Text size="sm" type="secondary">
          {description}
        </Text>
      )}
      <Form.Field
        label={m.name_label({ kind: "thing" })}
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
