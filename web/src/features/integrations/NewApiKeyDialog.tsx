import { useState } from "react";

import {
  API_SCOPES,
  type ApiScope,
  type IssuedApiKey,
  MAX_API_KEY_DAYS,
} from "../../domain/auth/integrations";
import { createApiKey } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { CopyableCode } from "../../ui/CopyableCode";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { CheckboxGroup } from "../../ui/kit/Checkbox";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { Select } from "../../ui/kit/Select";
import { RevealOnceDialog } from "../../ui/RevealOnceDialog";
import { apiScopeLabel } from "./labels";

const FORM_ID = "new-api-key";

const EXPIRY_OPTIONS = [
  { id: "30", label: m.api_key_expiry_30_days, days: 30 },
  { id: "90", label: m.api_key_expiry_90_days, days: 90 },
  {
    id: String(MAX_API_KEY_DAYS),
    label: m.api_key_expiry_1_year,
    days: MAX_API_KEY_DAYS,
  },
  { id: "never", label: m.api_key_expiry_never, days: null },
] as const;

/**
 * Names a key and picks what it may reach and how long it lasts. Once issued,
 * the form closes and the secret is shown, the only time it is visible; the
 * key list refreshes when that closes.
 */
export function NewApiKeyDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);

  return (
    <>
      <DialogSession open={open}>
        {(afterClose) => (
          <NewApiKeySession
            open={open}
            onClose={onClose}
            afterClose={afterClose}
            onIssued={(apiKey) => {
              onClose();
              setIssued(apiKey);
            }}
          />
        )}
      </DialogSession>
      <RevealOnceDialog
        revealed={issued}
        title={m.api_key_issued_title()}
        hint={m.api_key_dialog_shown_once()}
        onClose={() => {
          setIssued(null);
        }}
      >
        {(apiKey) => (
          <CopyableCode
            value={apiKey.secret}
            label={m.api_key_dialog_secret_label()}
          />
        )}
      </RevealOnceDialog>
    </>
  );
}

function NewApiKeySession({
  open,
  onClose,
  afterClose,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
  onIssued: (apiKey: IssuedApiKey) => void;
}) {
  const action = useAsyncAction();
  const [scopes, setScopes] = useState<ApiScope[]>(["experiments"]);
  const [expiry, setExpiry] = useState<string>(EXPIRY_OPTIONS[0].id);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.api_key_dialog_title()}
      okText={m.api_key_dialog_create()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={scopes.length === 0}
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const expiresInDays =
            EXPIRY_OPTIONS.find((option) => option.id === expiry)?.days ?? null;
          void action.run(
            () =>
              createApiKey({
                data: {
                  name: String(form.get("name") ?? ""),
                  scopes,
                  expiresInDays,
                },
              }),
            m.api_key_not_created(),
            { invalidate: false, onSuccess: onIssued },
          );
        }}
      >
        <Form.Field label={m.api_key_column_name()} name="name" required>
          <Input
            name="name"
            autoComplete="off"
            autoFocus
            disabled={action.busy}
            placeholder={m.api_key_dialog_name_placeholder()}
          />
        </Form.Field>
        <Form.Field label={m.api_key_column_scopes()} required fieldset>
          <CheckboxGroup
            value={scopes}
            disabled={action.busy}
            options={API_SCOPES.map((scope) => ({
              value: scope,
              label: apiScopeLabel(scope),
            }))}
            onChange={(next) =>
              setScopes(API_SCOPES.filter((scope) => next.includes(scope)))
            }
          />
        </Form.Field>
        <Form.Field label={m.api_key_dialog_expires_label()}>
          <Select
            value={expiry}
            disabled={action.busy}
            options={EXPIRY_OPTIONS.map((option) => ({
              value: option.id,
              label: option.label(),
            }))}
            onChange={setExpiry}
          />
        </Form.Field>
      </Form>
    </FormDialog>
  );
}
