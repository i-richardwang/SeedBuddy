import { createServerFn } from "@tanstack/react-start";

import { workerRefSchema } from "../domain/workers/schema";
import { listWorkerPresence } from "../server/queries/public";
import { requireAdministrator } from "./access";
import { enrollWorker, removeWorker } from "../server/workers/public";

export const getWorkers = createServerFn({ method: "GET" }).handler(
  listWorkerPresence,
);

/** Administrators enroll the machines that may serve as workers. */
export const addWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return enrollWorker(data.workerId);
  });

export const deleteWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    await removeWorker(data.workerId);
  });
