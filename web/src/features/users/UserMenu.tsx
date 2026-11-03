import { useRouter } from "@tanstack/react-router";
import { Ban, KeyRound, LogOut, Trash2, UserRoundCheck } from "lucide-react";
import { useState } from "react";

import type { UserAccount } from "../../domain/auth/schema";
import {
  reinstateUser,
  removeUser,
  resetUserPassword,
  signOutUserEverywhere,
  suspendUser,
} from "../../functions/users";
import { m } from "../../paraglide/messages";
import { RowMenu } from "../../ui/ActionsMenu";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { toast } from "../../ui/kit/Toast";
import { PasswordField } from "./PasswordField";

/** Everything an administrator does to another account, in one row menu. */
export function UserMenu({ account }: { account: UserAccount }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [resetting, setResetting] = useState(false);

  /** Runs a command; `done` confirms one whose effect the row does not show. */
  const act = (work: () => Promise<unknown>, failure: string, done?: string) =>
    void run(work, failure, {
      onSuccess: () => {
        if (done) toast.success(done);
      },
      invalidate: () => router.invalidate(),
    });

  return (
    <>
      <RowMenu
        label={m.user_actions({ name: account.name })}
        busy={busy}
        items={[
          {
            key: "reset-password",
            icon: KeyRound,
            label: m.user_menu_reset_password_item(),
            onClick: () => setResetting(true),
          },
          {
            key: "revoke",
            icon: LogOut,
            label: m.user_menu_sign_out_everywhere(),
            onClick: () =>
              act(
                () => signOutUserEverywhere({ data: { user: account.id } }),
                m.user_sessions_not_revoked(),
                m.user_signed_out_everywhere({ name: account.name }),
              ),
          },
          account.banned
            ? {
                key: "reinstate",
                icon: UserRoundCheck,
                label: m.user_menu_reinstate(),
                onClick: () =>
                  act(
                    () => reinstateUser({ data: { user: account.id } }),
                    m.user_not_reinstated(),
                  ),
              }
            : {
                key: "suspend",
                icon: Ban,
                label: m.user_menu_suspend_item(),
                onClick: () =>
                  confirmDestructive({
                    title: m.user_suspend_title({ name: account.name }),
                    content: m.user_suspend_body(),
                    confirmLabel: m.user_suspend_confirm(),
                    onConfirm: async () => {
                      await suspendUser({ data: { user: account.id } });
                    },
                    onSuccess: () => {
                      toast.success(m.user_suspended({ name: account.name }));
                    },
                    invalidate: () => router.invalidate(),
                  }),
              },
          { type: "divider" },
          {
            key: "delete",
            icon: Trash2,
            danger: true,
            label: m.user_menu_delete_item(),
            onClick: () =>
              confirmDestructive({
                title: m.user_delete_title({ name: account.name }),
                content: m.user_delete_body(),
                confirmLabel: m.user_delete_confirm(),
                onConfirm: async () => {
                  await removeUser({ data: { user: account.id } });
                },
                onSuccess: () => {
                  toast.success(m.user_deleted({ name: account.name }));
                },
                invalidate: () => router.invalidate(),
              }),
          },
        ]}
      />
      <ResetPasswordDialog
        account={account}
        open={resetting}
        onClose={() => setResetting(false)}
      />
    </>
  );
}

const RESET_FORM_ID = "reset-password";

function ResetPasswordDialog({
  account,
  open,
  onClose,
}: {
  account: UserAccount;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.user_reset_password_title({ name: account.name })}
      okText={m.user_dialog_save()}
      formId={RESET_FORM_ID}
      busy={action.busy}
    >
      <ResetPasswordForm account={account} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ResetPasswordForm({
  account,
  action: { busy, run },
  onDone,
}: {
  account: UserAccount;
  action: AsyncAction;
  onDone: () => void;
}) {
  return (
    <Form
      id={RESET_FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          () =>
            resetUserPassword({
              data: {
                user: account.id,
                password: String(form.get("password") ?? ""),
              },
            }),
          m.user_reset_password_not_changed(),
        ).then((result) => {
          if (!result.ok) return;
          toast.success(m.user_reset_password_changed());
          onDone();
        });
      }}
    >
      <PasswordField
        label={m.user_reset_password_new_label()}
        description={m.user_reset_password_description()}
        disabled={busy}
        autoFocus
      />
    </Form>
  );
}
