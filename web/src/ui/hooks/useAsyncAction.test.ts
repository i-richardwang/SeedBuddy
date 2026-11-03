import { describe, expect, spyOn, test } from "bun:test";

import { errorMessage } from "../errors";
import { toast } from "../kit/Toast";
import { runAction } from "./useAsyncAction";

describe("runAction", () => {
  test("preserves success and failure as different results", async () => {
    await expect(runAction(async () => 7, "Save failed")).resolves.toEqual({
      ok: true,
      value: 7,
    });
    const error = new Error("not saved");
    await expect(
      runAction(async () => {
        throw error;
      }, "Save failed"),
    ).resolves.toEqual({ ok: false, error });
  });

  test("reports a failure only while the caller still waits on it", async () => {
    const reported = spyOn(toast, "error").mockImplementation(() => {});
    try {
      const fail = async () => {
        throw new Error("not opened");
      };
      await runAction(fail, "Open failed");
      const left = new AbortController();
      left.abort();
      await runAction(fail, "Open failed", left.signal);
      expect(reported).toHaveBeenCalledTimes(1);
    } finally {
      reported.mockRestore();
    }
  });

  test("formats unknown failures", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage("offline")).toBe("offline");
  });
});

test("write completion only closes and reloads after success", async () => {
  const { expectIsolatedRun } = await import("../../../test/isolated");
  await expectIsolatedRun(
    "test/action-lifecycle.tsx",
    [],
    "action completion preserves failure and success lifetimes",
  );
});
