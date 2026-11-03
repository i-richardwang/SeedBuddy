import { expect, test } from "bun:test";

import { Route as LoginRoute } from "../../../routes/login";
import { readSession, redirect } from "./session";
import { TEST_PASSWORD, sessionHeaders, signInAs } from "../../testing/auth";

type LoginGet = (context: {
  request: Request;
  next: () => Response;
}) => Promise<Response>;

function loginGet(): LoginGet {
  const handlers = LoginRoute.options.server?.handlers as
    { GET?: LoginGet } | undefined;
  if (!handlers?.GET) throw new Error("login route has no GET handler");
  return handlers.GET;
}

test("document redirects use a relative Location", () => {
  const response = redirect("/login?returnTo=%2Fworkers");
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fworkers");
});

test("a request without a session has no account", async () => {
  expect(await readSession(new Headers())).toBeNull();
  expect(await readSession(new Headers({ cookie: "vitroflow=1" }))).toBeNull();
});

test("signing in yields a session that resolves to the account", async () => {
  const { user, headers } = await signInAs("member");
  expect(await readSession(headers)).toEqual({
    id: user.id,
    name: user.name,
    email: user.email,
    role: "member",
  });
  await expect(sessionHeaders(user.email, "not-the-password")).rejects.toThrow(
    "Sign-in refused: 401",
  );
});

test("the sign-in page renders for visitors and redirects signed-in users", async () => {
  const request = (cookie?: string) =>
    new Request(
      "http://example.invalid/login?returnTo=%2Fworkers%3Fworkers%3Donline",
      {
        headers: cookie === undefined ? {} : { cookie },
      },
    );
  const visitor = await loginGet()({
    request: request(),
    next: () => new Response("page"),
  });
  expect(await visitor.text()).toBe("page");

  const { headers } = await signInAs("member");
  const signedIn = await loginGet()({
    request: request(headers.get("cookie")!),
    next: () => new Response("page"),
  });
  expect(signedIn.status).toBe(303);
  expect(signedIn.headers.get("Location")).toBe("/workers?workers=online");
  expect(TEST_PASSWORD.length).toBeGreaterThanOrEqual(12);
});
