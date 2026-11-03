import { describe, expect, test } from "bun:test";

import { apiRequestAuthorization } from "./authorization";
import { issueApiKey } from "../../auth/api-keys";
import { apiKeyHeaders, signInAs } from "../../testing/auth";

function bearer(token?: string): Request {
  return new Request("http://workbench", {
    headers: token === undefined ? {} : apiKeyHeaders(token),
  });
}

describe("API credentials", () => {
  test("paths outside the transfer API leave the decision to the session", async () => {
    for (const pathname of [
      "/",
      "/login",
      "/experiments",
      "/api/experiments/mcp",
      "/api/annotation/mcp",
      "/api/worker/heartbeat",
    ]) {
      expect(await apiRequestAuthorization(pathname, bearer("x"))).toBe(null);
    }
  });

  test("the transfer realm admits keys holding its scope and defers to the session otherwise", async () => {
    const { user } = await signInAs("member");
    const agent = await issueApiKey(user.id, {
      name: "Agent",
      scopes: ["experiments"],
      expiresInDays: null,
    });
    const both = await issueApiKey(user.id, {
      name: "Both",
      scopes: ["experiments", "transfer"],
      expiresInDays: 30,
    });
    expect(
      await apiRequestAuthorization(
        "/api/agent/list-experiments",
        bearer(agent.secret),
      ),
    ).toBe(null);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer(agent.secret),
      ),
    ).toBe(false);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer(both.secret),
      ),
    ).toBe(true);
    expect(
      await apiRequestAuthorization(
        "/api/agent/list-experiments",
        bearer("vf_wrong"),
      ),
    ).toBe(null);
    expect(
      await apiRequestAuthorization("/api/agent/list-experiments", bearer()),
    ).toBe(null);
    expect(
      await apiRequestAuthorization("/api/transfer/datasets/x", bearer()),
    ).toBe(null);
    expect(
      await apiRequestAuthorization(
        "/api/transfer/datasets/x",
        bearer("vf_wrong"),
      ),
    ).toBe(false);
  });
});
