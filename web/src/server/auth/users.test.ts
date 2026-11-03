import { describe, expect, test } from "bun:test";

import { UserRejectedError } from "../../domain/auth/errors";
import { sessionHeaders, signInAs, TEST_PASSWORD } from "../testing/auth";
import { readSession } from "../transport/http/session";
import {
  banUser,
  createUser,
  deleteUser,
  listUsers,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  unbanUser,
} from "./users";

let sequence = 0;
function draft(role: "admin" | "member" = "member") {
  sequence += 1;
  return {
    name: `Directory ${sequence}`,
    email: `directory-${sequence}@test.invalid`,
    password: TEST_PASSWORD,
    role,
  };
}

describe("account directory", () => {
  test("only administrators read or change the directory", async () => {
    const member = await signInAs("member");
    await expect(listUsers(member.headers)).rejects.toThrow();
    await expect(createUser(member.headers, draft())).rejects.toThrow();
    await expect(listUsers(new Headers())).rejects.toThrow();
  });

  test("an administrator adds accounts that can sign in", async () => {
    const admin = await signInAs("admin");
    const input = draft();
    const created = await createUser(admin.headers, input);
    expect(created).toMatchObject({
      name: input.name,
      email: input.email,
      role: "member",
      banned: false,
    });
    expect(await listUsers(admin.headers)).toContainEqual(created);
    const session = await readSession(
      await sessionHeaders(input.email, input.password),
    );
    expect(session?.id).toBe(created.id);
    await expect(createUser(admin.headers, input)).rejects.toThrow();
  });

  test("roles change for other accounts, never one's own", async () => {
    const admin = await signInAs("admin");
    const target = await createUser(admin.headers, draft());
    const promoted = await setUserRole(admin.headers, {
      user: target.id,
      role: "admin",
    });
    expect(promoted.role).toBe("admin");
    await expect(
      setUserRole(admin.headers, { user: admin.user.id, role: "member" }),
    ).rejects.toBeInstanceOf(UserRejectedError);
    await expect(
      setUserRole(admin.headers, { user: "nobody", role: "member" }),
    ).rejects.toThrow("Unknown user: nobody");
  });

  test("a new password signs in and the old one does not", async () => {
    const admin = await signInAs("admin");
    const input = draft();
    const target = await createUser(admin.headers, input);
    await setUserPassword(admin.headers, {
      user: target.id,
      password: "a-different-passphrase",
    });
    await expect(sessionHeaders(input.email, input.password)).rejects.toThrow();
    expect(
      await readSession(
        await sessionHeaders(input.email, "a-different-passphrase"),
      ),
    ).toMatchObject({ id: target.id });
    await expect(
      setUserPassword(admin.headers, {
        user: admin.user.id,
        password: "admin-cannot-bypass-current-password",
      }),
    ).rejects.toBeInstanceOf(UserRejectedError);
  });

  test("suspension ends sessions and refuses sign-in until reinstated", async () => {
    const admin = await signInAs("admin");
    const target = await signInAs("member");
    const suspended = await banUser(admin.headers, {
      user: target.user.id,
    });
    expect(suspended.banned).toBe(true);
    expect(await readSession(target.headers)).toBeNull();
    await expect(
      sessionHeaders(target.user.email, TEST_PASSWORD),
    ).rejects.toThrow();
    await expect(
      banUser(admin.headers, { user: admin.user.id }),
    ).rejects.toBeInstanceOf(UserRejectedError);

    const reinstated = await unbanUser(admin.headers, {
      user: target.user.id,
    });
    expect(reinstated.banned).toBe(false);
    expect(
      await readSession(await sessionHeaders(target.user.email, TEST_PASSWORD)),
    ).toMatchObject({ id: target.user.id });
  });

  test("revoking sessions signs the account out everywhere", async () => {
    const admin = await signInAs("admin");
    const target = await signInAs("member");
    await revokeUserSessions(admin.headers, { user: target.user.id });
    expect(await readSession(target.headers)).toBeNull();
  });

  test("deletion removes the account and refuses the acting administrator", async () => {
    const admin = await signInAs("admin");
    const target = await signInAs("member");
    await deleteUser(admin.headers, { user: target.user.id });
    expect(await readSession(target.headers)).toBeNull();
    expect(
      (await listUsers(admin.headers)).some(
        (account) => account.id === target.user.id,
      ),
    ).toBe(false);
    await expect(
      deleteUser(admin.headers, { user: admin.user.id }),
    ).rejects.toBeInstanceOf(UserRejectedError);
  });
});
