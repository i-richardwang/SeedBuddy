import { createServerFn } from "@tanstack/react-start";

import { workerRefSchema } from "../domain/workers/schema";
import { listWorkerOverviews } from "../server/queries/public";
import * as workersService from "../server/workers/public";
import { requireAdministrator } from "./access";

export const getWorkers = createServerFn({ method: "GET" }).handler(
  listWorkerOverviews,
);

/** Administrators enroll the machines that may serve as workers. */
export const createWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    return workersService.enrollWorker(data.workerId);
  });

export const removeWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdministrator();
    await workersService.removeWorker(data.workerId);
  });
