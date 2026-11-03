import { describe, expect, test } from "bun:test";

import { auth } from "./service";
import { readSession } from "../transport/http/session";
import { TEST_PASSWORD, sessionHeaders, signInAs } from "../testing/auth";

describe("personal account", () => {
  test("a user changes their own password and revokes other sessions", async () => {
    const { user, headers } = await signInAs("member");
    const otherSession = await sessionHeaders(user.email, TEST_PASSWORD);
    const nextPassword = "new-correct-horse-battery";

    const response = await (
      await auth()
    ).api.changePassword({
      headers,
      asResponse: true,
      body: {
        currentPassword: TEST_PASSWORD,
        newPassword: nextPassword,
        revokeOtherSessions: true,
      },
    });
    const currentSession = new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((entry) => entry.split(";", 1)[0]!)
        .join("; "),
    });

    expect((await readSession(currentSession))?.id).toBe(user.id);
    expect(await readSession(otherSession)).toBeNull();
    await expect(sessionHeaders(user.email, TEST_PASSWORD)).rejects.toThrow(
      "Sign-in refused",
    );
    expect(
      (await readSession(await sessionHeaders(user.email, nextPassword)))?.id,
    ).toBe(user.id);
  });
});
