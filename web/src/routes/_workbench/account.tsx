import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { ChangePasswordDialog } from "../../features/account/ChangePasswordDialog";
import { USER_ROLE_LABELS } from "../../features/users/labels";
import { m } from "../../paraglide/messages";
import { documentTitle } from "../../ui/documentTitle";
import { Button } from "../../ui/kit/Button";
import {
  SettingsGroup,
  SettingsRow,
  SettingsValueRow,
} from "../../ui/kit/Settings";
import { SettingsPage } from "../../ui/Page";
import { ColorSchemeSelect, LanguageSelect } from "../../ui/Preferences";

const workbench = getRouteApi("/_workbench");

export const Route = createFileRoute("/_workbench/account")({
  staticData: { crumbs: () => [{ label: m.account_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.account_title()) }],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user } = workbench.useLoaderData();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <SettingsPage title={m.account_title()}>
      <SettingsGroup title={m.account_profile()}>
        <SettingsValueRow label={m.account_name()}>
          {user.name}
        </SettingsValueRow>
        <SettingsValueRow label={m.account_email()}>
          {user.email}
        </SettingsValueRow>
        <SettingsValueRow label={m.role_label()}>
          {USER_ROLE_LABELS[user.role]()}
        </SettingsValueRow>
        <SettingsValueRow
          label={m.account_password()}
          action={
            <Button size="small" onClick={() => setChangingPassword(true)}>
              {m.account_change_password()}
            </Button>
          }
        />
      </SettingsGroup>
      <SettingsGroup title={m.account_preferences()}>
        <SettingsRow label={m.account_language()}>
          <LanguageSelect aria-label={m.account_language()} />
        </SettingsRow>
        <SettingsRow label={m.account_color_scheme()}>
          <ColorSchemeSelect aria-label={m.account_color_scheme()} />
        </SettingsRow>
      </SettingsGroup>
      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
      />
    </SettingsPage>
  );
}
