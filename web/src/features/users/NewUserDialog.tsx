import { useState } from "react";

import type { UserRole } from "../../domain/auth/schema";
import { addUser } from "../../functions/users";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { PasswordField } from "../../ui/PasswordField";
import { RoleSelect } from "./RoleSelect";

const FORM_ID = "new-user";

export function NewUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.users_new()}
      okText={m.user_dialog_add()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <NewUserForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

function NewUserForm({
  action: { busy, run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const [role, setRole] = useState<UserRole>("member");

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          () =>
            addUser({
              data: {
                name: String(form.get("name") ?? ""),
                email: String(form.get("email") ?? ""),
                password: String(form.get("password") ?? ""),
                role,
              },
            }),
          m.user_not_added(),
          {
            onSuccess: onDone,
          },
        );
      }}
    >
      <Form.Field label={m.user_dialog_name_label()} name="name" required>
        <Input name="name" autoComplete="off" autoFocus disabled={busy} />
      </Form.Field>
      <Form.Field label={m.user_dialog_email_label()} name="email" required>
        <Input name="email" type="email" autoComplete="off" disabled={busy} />
      </Form.Field>
      <PasswordField
        label={m.user_dialog_initial_password_label()}
        disabled={busy}
      />
      <Form.Field label={m.role_label()}>
        <RoleSelect value={role} onChange={setRole} disabled={busy} />
      </Form.Field>
    </Form>
  );
}
