import { expect, test } from "bun:test";

import { database } from "../../infra/db/client";
import { signInAs } from "../../testing/auth";
import {
  authenticateWorker,
  enrollWorker,
  listEnrolledWorkers,
} from "../../workers/public";
import { handlePersonalWorkerEnrollment } from "./personal-worker";

function enrollment(
  headers: Headers,
  body: unknown,
  contentType = "application/json",
): Request {
  const sent = new Headers(headers);
  sent.set("Content-Type", contentType);
  return new Request("http://localhost/api/personal-workers", {
    method: "POST",
    headers: sent,
    body: JSON.stringify(body),
  });
}

async function enrolled(headers: Headers, workerId: string): Promise<string> {
  const response = await handlePersonalWorkerEnrollment(
    enrollment(headers, { workerId }),
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = (await response.json()) as { workerId: string; token: string };
  expect(body.workerId).toBe(workerId);
  return body.token;
}

test("a signed-in account enrolls the computer it is using as its own worker", async () => {
  const { user, headers } = await signInAs("member");

  const token = await enrolled(headers, "enrolling-laptop");

  expect(await authenticateWorker(token)).toEqual({
    workerId: "enrolling-laptop",
    suspended: false,
  });
  expect(await listEnrolledWorkers(await database())).toContainEqual({
    workerId: "enrolling-laptop",
    owner: { id: user.id, name: user.name },
  });
});

test("enrolling again under the same name replaces the token", async () => {
  const { headers } = await signInAs("member");
  const first = await enrolled(headers, "reenrolling-laptop");

  const second = await enrolled(headers, "reenrolling-laptop");

  expect(await authenticateWorker(first)).toBeNull();
  expect(await authenticateWorker(second)).toEqual({
    workerId: "reenrolling-laptop",
    suspended: false,
  });
});

test("a name another worker holds is taken", async () => {
  const { headers } = await signInAs("member");
  const other = await signInAs("member");
  await enrollWorker("shared-rack", null);
  await enrollWorker("someone-elses-laptop", other.user.id);
  for (const workerId of ["shared-rack", "someone-elses-laptop"]) {
    const refused = await handlePersonalWorkerEnrollment(
      enrollment(headers, { workerId }),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: `A worker named ${workerId} is already enrolled`,
    });
  }
});

test("enrolling a computer needs a session and a worker name", async () => {
  const { headers } = await signInAs("member");
  expect(
    (
      await handlePersonalWorkerEnrollment(
        enrollment(new Headers(), { workerId: "unsigned-laptop" }),
      )
    ).status,
  ).toBe(401);
  for (const body of [{}, { workerId: "no spaces" }, "laptop"])
    expect(
      (await handlePersonalWorkerEnrollment(enrollment(headers, body))).status,
    ).toBe(400);
});

test("a request a page of another site could send is not read", async () => {
  const { headers } = await signInAs("member");
  const refused = await handlePersonalWorkerEnrollment(
    enrollment(headers, { workerId: "form-posted-laptop" }, "text/plain"),
  );
  expect(refused.status).toBe(400);
  expect(await listEnrolledWorkers(await database())).not.toContainEqual(
    expect.objectContaining({ workerId: "form-posted-laptop" }),
  );
});
