import { WorkerNameTakenError } from "../../../domain/workers/errors";
import { workerRefSchema } from "../../../domain/workers/schema";
import { reenrollPersonalWorker } from "../../workers/public";
import { readSession } from "./session";

function refusal(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Enrolls the computer a signed-in account is using as that account's
 * personal worker, for a program on the computer that holds the account's
 * browser session, and answers with the worker's token, the only time it is
 * given. Asking again under the same name enrolls the computer anew, so a
 * program that lost the token gets another. Only a JSON request is read,
 * which no page of another site can send with the session.
 */
export async function handlePersonalWorkerEnrollment(
  request: Request,
): Promise<Response> {
  const user = await readSession(request.headers);
  if (!user) return refusal("Sign in to enroll this computer", 401);
  const json = request.headers
    .get("Content-Type")
    ?.startsWith("application/json");
  const named = workerRefSchema.safeParse(
    json ? await request.json().catch(() => null) : null,
  );
  if (!named.success)
    return refusal(
      'The request body must be the JSON {"workerId": "<name>"}',
      400,
    );
  try {
    return Response.json(
      await reenrollPersonalWorker(user.id, named.data.workerId),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof WorkerNameTakenError)
      return refusal(error.message, 409);
    throw error;
  }
}
