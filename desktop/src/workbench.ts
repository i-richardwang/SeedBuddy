import { createHash } from "node:crypto";

/** A request as the app's window makes it: with its cookies, through its proxy. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The Worker package a workbench ships, as `/worker-package.json` describes it. */
export interface WorkerPackage {
  /** Identity of the wheel, pinned dependencies, Python and host contract. */
  id: string;
  filename: string;
  /** The SHA-256 of the package, as lower-case hex. */
  digest: string;
  hostProtocol: number;
  python: string;
  requirements: string;
}

export class IncompatibleRuntime extends Error {}
export const HOST_PROTOCOL = 1;

/**
 * What asking a workbench to enroll this computer comes to: the Worker's
 * token, nobody signed in to enroll it for, or a name another Worker holds.
 */
export type Enrollment =
  | { kind: "enrolled"; token: string }
  | { kind: "signed-out" }
  | { kind: "taken" };

/** A `seedctl` wheel by name, and nothing that leads out of a folder. */
const WHEEL = /^seedctl-[^/\\]+\.whl$/;
const SHA256 = /^[a-f0-9]{64}$/;
/** How long the workbench has to answer a question, and to send its package. */
const ANSWER_MS = 10_000;
const DOWNLOAD_MS = 5 * 60_000;

/** `signal`, or the workbench taking longer than `ms`. */
const within = (ms: number, signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(ms)]);

/**
 * The origin of the workbench a person names, or null when what they typed
 * is no web address. A bare host is taken as https.
 */
export function parseServer(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed)
    ? typed
    : `https://${typed}`;
  const url = URL.parse(address);
  return url?.protocol === "https:" || url?.protocol === "http:"
    ? url.origin
    : null;
}

/** The fields of the JSON object a workbench answered with; none for anything else. */
async function fieldsOf(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * Whether a workbench answers at `server` itself: an address that leads on
 * to another site is not a workbench's.
 */
export function answers(fetch: Fetch, server: string): Promise<boolean> {
  return fetch(`${server}/healthz`, {
    redirect: "error",
    signal: AbortSignal.timeout(ANSWER_MS),
  }).then(
    (response) => response.ok,
    () => false,
  );
}

/** Which Worker package the workbench ships, or null when it ships none. */
export async function describePackage(
  fetch: Fetch,
  server: string,
  signal: AbortSignal,
): Promise<WorkerPackage | null> {
  const response = await fetch(`${server}/worker-package.json`, {
    signal: within(ANSWER_MS, signal),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `The workbench did not describe its Worker package (${response.status})`,
    );
  const { id, filename, digest, hostProtocol, python, requirements } =
    await fieldsOf(response);
  if (hostProtocol !== HOST_PROTOCOL)
    throw new IncompatibleRuntime(
      "This workbench and Desktop use different Worker host protocols. Update the workbench and Desktop before serving.",
    );
  if (
    typeof id !== "string" ||
    !SHA256.test(id) ||
    typeof python !== "string" ||
    !/^3\.\d+\.\d+$/.test(python) ||
    typeof requirements !== "string" ||
    !requirements.trim() ||
    typeof filename !== "string" ||
    typeof digest !== "string" ||
    !WHEEL.test(filename) ||
    !SHA256.test(digest)
  )
    throw new Error("The workbench described no Worker package this app reads");
  return { id, filename, digest, hostProtocol, python, requirements };
}

/** The package the workbench ships, once what arrived is what it described. */
export async function downloadPackage(
  fetch: Fetch,
  server: string,
  { filename, digest }: Pick<WorkerPackage, "filename" | "digest">,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(`${server}/worker-package/${filename}`, {
    signal: within(DOWNLOAD_MS, signal),
  });
  if (!response.ok)
    throw new Error(
      `The workbench did not send its Worker package (${response.status})`,
    );
  const content = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(content).digest("hex") !== digest)
    throw new Error(
      "The Worker package is not the one the workbench described",
    );
  return content;
}

/**
 * Enrolls this computer under `workerName` as the personal Worker of the
 * account signed in to the workbench. Asking again under the same name gives
 * a new token.
 */
export async function enroll(
  fetch: Fetch,
  server: string,
  workerName: string,
  signal: AbortSignal,
): Promise<Enrollment> {
  const response = await fetch(`${server}/api/personal-workers`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId: workerName }),
    signal: within(ANSWER_MS, signal),
  });
  if (response.status === 401) return { kind: "signed-out" };
  if (response.status === 409) return { kind: "taken" };
  if (!response.ok)
    throw new Error(
      `The workbench did not enroll this computer (${response.status})`,
    );
  const { token } = await fieldsOf(response);
  if (typeof token !== "string" || !token)
    throw new Error("The workbench enrolled this computer without a token");
  return { kind: "enrolled", token };
}
