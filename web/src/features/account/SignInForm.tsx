import { Lock, Mail } from "lucide-react";
import { useState } from "react";

import { m } from "../../paraglide/messages";
import { AuthPage } from "../../ui/AuthPage";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { Button } from "../../ui/kit/Button";
import { Form } from "../../ui/kit/Form";
import { Icon } from "../../ui/kit/Icon";
import { Input, InputPassword } from "../../ui/kit/Input";
import { Text } from "../../ui/kit/Text";
import { authClient, continuation } from "./client";

/**
 * Sign-in in two steps: the email, then the password under the email it is
 * for. Going back keeps the email for editing. The password step carries
 * the email in a hidden username field, so a password manager files the
 * pair together.
 */
export function SignInForm({ destination }: { destination: string }) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const { busy, run } = useAsyncAction();
  const [email, setEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState(false);

  if (email === null) {
    return (
      <AuthPage
        title={m.login_heading({ app: m.app_name() })}
        actions={
          <Text as="p" size="sm" type="secondary" className="text-center">
            {m.login_description()}
          </Text>
        }
      >
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            setEmail(draft.trim());
          }}
        >
          <Form.Field name="email" label={m.email_label()} labelHidden>
            <Input
              size="large"
              required
              autoFocus
              type="email"
              autoComplete="username"
              placeholder={m.login_email_placeholder()}
              prefix={<Icon icon={Mail} />}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Form.Field>
          <Button block htmlType="submit" size="large" type="primary">
            {m.login_next()}
          </Button>
        </Form>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title={m.login_password_heading()}
      description={email}
      actions={
        <Text as="p" size="sm" type="secondary" className="text-center">
          <Button
            type="text"
            onClick={() => {
              setRejected(false);
              setEmail(null);
            }}
          >
            {m.login_back_to_email()}
          </Button>
        </Text>
      }
    >
      <Form
        errors={rejected ? { password: m.login_rejected() } : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(
            async () => {
              const { data, error } = await authClient.signIn.email({
                email,
                password: String(form.get("password") ?? ""),
              });
              if (error) {
                setRejected(true);
                throw new Error(error.message ?? m.login_rejected());
              }
              return continuation(data) ?? destination;
            },
            m.login_not_completed(),
            {
              invalidate: false,
              onSuccess: async (next) => {
                if (next !== destination) {
                  window.location.assign(next);
                  return;
                }
                await navigateAfterWrite({ href: destination });
              },
            },
          );
        }}
      >
        <input
          hidden
          readOnly
          autoComplete="username"
          name="username"
          type="email"
          value={email}
        />
        <Form.Field name="password" label={m.account_password()} labelHidden>
          <InputPassword
            size="large"
            required
            disabled={busy}
            autoFocus
            autoComplete="current-password"
            placeholder={m.login_password_placeholder()}
            prefix={<Icon icon={Lock} />}
            onChange={() => setRejected(false)}
          />
        </Form.Field>
        <Button
          block
          htmlType="submit"
          size="large"
          type="primary"
          loading={busy}
        >
          {m.login_submit()}
        </Button>
      </Form>
    </AuthPage>
  );
}
