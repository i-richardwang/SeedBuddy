import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";

import type { WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { AppShellAccount, useAppShell } from "../../ui/kit/AppShell";
import { authClient } from "./client";

/** The signed-in person atop the sidebar: settings and signing out. */
export function SignedInUser({ user }: { user: WorkbenchUser }) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const navigate = useNavigate();
  const shell = useAppShell();
  const { busy, run } = useAsyncAction();

  const signOut = () =>
    void run(
      async () => {
        const { error } = await authClient.signOut();
        if (error) throw new Error(error.message);
      },
      m.account_not_signed_out(),
      {
        invalidate: false,
        onSuccess: async () => {
          await navigateAfterWrite({ to: "/login" });
        },
      },
    );

  return (
    <AppShellAccount
      label={m.nav_account_menu()}
      name={user.name}
      items={[
        {
          key: "settings",
          icon: Settings,
          label: m.nav_settings(),
          onClick: () => {
            shell.closeNavigation();
            void navigate({ to: "/account" });
          },
        },
        { type: "divider" },
        {
          key: "sign-out",
          icon: LogOut,
          label: m.sign_out(),
          disabled: busy,
          onClick: signOut,
        },
      ]}
    />
  );
}
