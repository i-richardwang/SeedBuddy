import { describe, expect, test } from "bun:test";

import { ApiKeyNotFoundError } from "../../domain/auth/errors";
import { API_KEY_PREFIX } from "../../domain/auth/integrations";
import { apiKeyHeaders, signInAs } from "../testing/auth";
import {
  apiKeyPrincipal,
  issueApiKey,
  listApiKeys,
  revokeApiKey,
} from "./api-keys";
import { setUserStatus } from "./users";

function requestWith(secret: string | null): Request {
  return new Request("http://workbench/api/agent/list-experiments", {
    headers: secret === null ? {} : apiKeyHeaders(secret),
  });
}

describe("API keys", () => {
  test("a key is issued once with its secret and listed without it", async () => {
    const { user } = await signInAs("member");
    const issued = await issueApiKey(user.id, {
      name: "Laptop",
      scopes: ["experiments"],
      expiresInDays: 30,
    });
    expect(issued.secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(issued.start).toBe(issued.secret.slice(0, issued.start.length));
    expect(issued.scopes).toEqual(["experiments"]);
    expect(issued.expiresAt).not.toBeNull();

    const listed = await listApiKeys(user.id);
    expect(listed.map((key) => key.id)).toEqual([issued.id]);
    expect(listed[0]).not.toHaveProperty("secret");
    expect(listed[0]?.lastUsedAt).toBeNull();
  });

  test("a key admits its owner to its scopes and records use", async () => {
    const { user } = await signInAs("member");
    const issued = await issueApiKey(user.id, {
      name: "Transfer",
      scopes: ["transfer"],
      expiresInDays: null,
    });
    expect(
      await apiKeyPrincipal(requestWith(issued.secret), "transfer"),
    ).toEqual({ user: user.id, client: issued.id });
    expect(
      await apiKeyPrincipal(requestWith(issued.secret), "experiments"),
    ).toBeNull();
    expect(await apiKeyPrincipal(requestWith(null), "transfer")).toBeNull();
    expect(
      await apiKeyPrincipal(requestWith("vf_nonsense"), "transfer"),
    ).toBeNull();
    const [listed] = await listApiKeys(user.id);
    expect(listed?.lastUsedAt).not.toBeNull();
  });

  test("keys are private to their owner and stop at revocation", async () => {
    const owner = await signInAs("member");
    const other = await signInAs("member");
    const issued = await issueApiKey(owner.user.id, {
      name: "Mine",
      scopes: ["experiments"],
      expiresInDays: null,
    });
    expect(await listApiKeys(other.user.id)).toEqual([]);
    await expect(revokeApiKey(other.user.id, issued.id)).rejects.toBeInstanceOf(
      ApiKeyNotFoundError,
    );
    await revokeApiKey(owner.user.id, issued.id);
    expect(await listApiKeys(owner.user.id)).toEqual([]);
    expect(
      await apiKeyPrincipal(requestWith(issued.secret), "experiments"),
    ).toBeNull();
  });

  test("a suspended owner's keys admit nobody", async () => {
    const admin = await signInAs("admin");
    const { user } = await signInAs("member");
    const issued = await issueApiKey(user.id, {
      name: "Agent",
      scopes: ["experiments"],
      expiresInDays: null,
    });
    await setUserStatus(admin.user, { suspended: true, user: user.id });
    expect(
      await apiKeyPrincipal(requestWith(issued.secret), "experiments"),
    ).toBeNull();
  });
});
