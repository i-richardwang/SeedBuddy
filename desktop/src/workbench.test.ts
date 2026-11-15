import { createHash } from "node:crypto";

import { expect, spyOn, test } from "bun:test";

import {
  answers,
  describePackage,
  downloadPackage,
  enroll,
  type Fetch,
  parseServer,
} from "./workbench";

const SERVER = "https://seedbuddy.example.org";

const { signal } = new AbortController();

/** A workbench that answers every request with one response, and keeps the requests. */
function workbench(response: () => Response) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({ url, init });
    return response();
  };
  return { fetch, requests };
}

test("a workbench address comes down to its origin", () => {
  expect(parseServer(" seedbuddy.example.org/experiments ")).toBe(
    "https://seedbuddy.example.org",
  );
  expect(parseServer("http://localhost:3000/login")).toBe(
    "http://localhost:3000",
  );
});

test("what is no web address names no workbench", () => {
  expect(parseServer("")).toBeNull();
  expect(parseServer("ftp://seedbuddy.example.org")).toBeNull();
  expect(parseServer("http://")).toBeNull();
});

test("a workbench answers where its health check does", async () => {
  const { fetch, requests } = workbench(() => new Response("ok"));

  expect(await answers(fetch, SERVER)).toBe(true);
  expect(requests[0]?.url).toBe(`${SERVER}/healthz`);
  expect(requests[0]?.init).toMatchObject({ redirect: "error" });
});

test("no workbench answers where the request fails or is refused", async () => {
  const refused = workbench(() => new Response("", { status: 404 }));
  const unreachable: Fetch = () => Promise.reject(new Error("unreachable"));

  expect(await answers(refused.fetch, SERVER)).toBe(false);
  expect(await answers(unreachable, SERVER)).toBe(false);
});

test("the package a workbench ships is the one it describes", async () => {
  const shipped = {
    filename: "seedctl-1.0.0-py3-none-any.whl",
    digest: "ab".repeat(32),
  };
  const { fetch, requests } = workbench(() => Response.json(shipped));

  expect(await describePackage(fetch, SERVER, signal)).toEqual(shipped);
  expect(requests[0]?.url).toBe(`${SERVER}/worker-package.json`);
});

test.each([
  { filename: "../seedctl-1.0.0-py3-none-any.whl", digest: "ab".repeat(32) },
  { filename: "tool-1.0.0-py3-none-any.whl", digest: "ab".repeat(32) },
  { filename: "seedctl-1.0.0-py3-none-any.whl", digest: "ab" },
  { filename: "seedctl-1.0.0-py3-none-any.whl" },
  null,
  ["seedctl-1.0.0-py3-none-any.whl"],
])(
  "a description that names no seedctl wheel and digest is refused",
  async (described) => {
    const { fetch } = workbench(() => Response.json(described));

    await expect(describePackage(fetch, SERVER, signal)).rejects.toThrow(
      "described no Worker package",
    );
  },
);

test("a workbench that ships no package describes none", async () => {
  const { fetch } = workbench(() => new Response("", { status: 404 }));

  expect(await describePackage(fetch, SERVER, signal)).toBeNull();
});

test("a workbench is given 10 seconds to answer and 5 minutes to send its package", async () => {
  const late = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(late.signal);
  const asked: (AbortSignal | undefined)[] = [];
  const silent: Fetch = async (_url, init) => {
    asked.push(init?.signal ?? undefined);
    throw new Error("unreachable");
  };
  const described = {
    filename: "seedctl-1.0.0-py3-none-any.whl",
    digest: "ab".repeat(32),
  };
  try {
    await answers(silent, SERVER);
    await describePackage(silent, SERVER, signal).catch(() => {});
    await downloadPackage(silent, SERVER, described, signal).catch(() => {});
    await enroll(silent, SERVER, "lab-mac-1a2b", signal).catch(() => {});

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      10_000, 10_000, 300_000, 10_000,
    ]);
  } finally {
    timeout.mockRestore();
  }
  late.abort();
  expect(asked.map((request) => request?.aborted)).toEqual([
    true,
    true,
    true,
    true,
  ]);
});

test("a request is dropped with the signal it was made under", async () => {
  const abort = new AbortController();
  const dropped: Fetch = (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    });
  const asked = describePackage(dropped, SERVER, abort.signal);

  abort.abort(new Error("dropped"));

  await expect(asked).rejects.toThrow("dropped");
});

test("a workbench that fails to describe its package is an error", async () => {
  const { fetch } = workbench(() => new Response("", { status: 502 }));

  await expect(describePackage(fetch, SERVER, signal)).rejects.toThrow("502");
});

test("a package downloads when it is the one described", async () => {
  const digest = createHash("sha256").update("a wheel").digest("hex");
  const { fetch, requests } = workbench(() => new Response("a wheel"));

  const content = await downloadPackage(
    fetch,
    SERVER,
    { filename: "seedctl-1.0.0-py3-none-any.whl", digest },
    signal,
  );

  expect(new TextDecoder().decode(content)).toBe("a wheel");
  expect(requests[0]?.url).toBe(
    `${SERVER}/worker-package/seedctl-1.0.0-py3-none-any.whl`,
  );
});

test("a package that is not the one described is refused", async () => {
  const { fetch } = workbench(() => new Response("another wheel"));
  const described = {
    filename: "seedctl-1.0.0-py3-none-any.whl",
    digest: "ab".repeat(32),
  };

  await expect(
    downloadPackage(fetch, SERVER, described, signal),
  ).rejects.toThrow("not the one the workbench described");
});

test("enrolling sends the name with the session and returns the token", async () => {
  const { fetch, requests } = workbench(() =>
    Response.json(
      { workerId: "lab-mac-1a2b", token: "token" },
      { status: 201 },
    ),
  );

  expect(await enroll(fetch, SERVER, "lab-mac-1a2b", signal)).toEqual({
    kind: "enrolled",
    token: "token",
  });
  expect(requests[0]?.url).toBe(`${SERVER}/api/personal-workers`);
  expect(requests[0]?.init).toMatchObject({
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ workerId: "lab-mac-1a2b" }),
  });
});

test.each([
  [401, "signed-out"],
  [409, "taken"],
] as const)(
  "a %i from the workbench is told apart as %s",
  async (status, kind) => {
    const { fetch } = workbench(() => Response.json({ error: "" }, { status }));

    expect(await enroll(fetch, SERVER, "lab-mac-1a2b", signal)).toEqual({
      kind,
    });
  },
);

test.each([
  () => Response.json({ workerId: "lab-mac-1a2b" }, { status: 201 }),
  () => new Response("enrolled", { status: 201 }),
])("an enrollment that comes without a token is an error", async (answer) => {
  const { fetch } = workbench(answer);

  await expect(enroll(fetch, SERVER, "lab-mac-1a2b", signal)).rejects.toThrow(
    "without a token",
  );
});

test("any other refusal to enroll is an error", async () => {
  const { fetch } = workbench(() => new Response("", { status: 400 }));

  await expect(enroll(fetch, SERVER, "lab mac", signal)).rejects.toThrow("400");
});
