import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { Lock, Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import {
  carriesAuthorizationRequest,
  returnPath,
} from "../domain/auth/navigation";
import { AuthPage } from "../features/account/AuthPage";
import { authClient, continuation } from "../features/account/client";
import { m } from "../paraglide/messages";
import { readSession, redirect } from "../server/transport/http/session";
import { documentTitle } from "../ui/documentTitle";
import { useAsyncAction } from "../ui/hooks/useAsyncAction";
import { Button } from "../ui/kit/Button";
import { Form } from "../ui/kit/Form";
import { Icon } from "../ui/kit/Icon";
import { Input, InputPassword } from "../ui/kit/Input";
import { Text } from "../ui/kit/Text";

/**
 * A signed-in visitor is sent on to their destination, unless the visit is
 * an OAuth authorization request that asked for a fresh sign-in: the query
 * on the page is what resumes that request once they sign in again.
 */
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }).loose(),
  head: () => ({
    meta: [{ title: documentTitle(m.login_title()) }],
  }),
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        const { searchParams } = new URL(request.url);
        if (carriesAuthorizationRequest(searchParams)) return next();
        return (await readSession(request.headers))
          ? redirect(returnPath(searchParams.get("returnTo")))
          : next();
      },
    },
  },
  component: LoginPage,
});

/**
 * Sign-in in two steps: the email, then the password under the email it is
 * for. Going back keeps the email for editing. The password step carries
 * the email in a hidden username field, so a password manager files the
 * pair together.
 */
function LoginPage() {
  const { returnTo } = Route.useSearch();
  const destination = returnPath(returnTo);
  const navigate = useNavigate();
  const router = useRouter();
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
          <Form.Field name="email" label={m.login_email()} labelHidden>
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
          <button
            className="cursor-pointer underline"
            type="button"
            onClick={() => {
              setRejected(false);
              setEmail(null);
            }}
          >
            {m.login_back_to_email()}
          </button>
        </Text>
      }
    >
      <Form
        errors={rejected ? { password: m.login_rejected() } : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            const { data, error } = await authClient.signIn.email({
              email,
              password: String(form.get("password") ?? ""),
            });
            if (error) {
              setRejected(true);
              return null;
            }
            return continuation(data) ?? destination;
          }, m.login_failed()).then(async (result) => {
            if (!result.ok || result.value === null) return;
            if (result.value !== destination) {
              window.location.assign(result.value);
              return;
            }
            await router.invalidate();
            await navigate({ href: destination });
          });
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
        <Form.Field name="password" label={m.login_password()} labelHidden>
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
