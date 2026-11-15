import { createServerFn } from "@tanstack/react-start";

import { isAdmin } from "../domain/auth/schema";
import {
  workerEnrollmentRequestSchema,
  workerRefSchema,
} from "../domain/workers/schema";
import { workerPresenceDetail } from "../server/queries/public";
import {
  enrollWorker,
  removePersonalWorker,
  removeWorker as removeWorkerService,
  shippedWorkerPackage,
} from "../server/workers/public";
import { requireAccount, requireAdministrator } from "./access";

export const getWorkers = createServerFn({ method: "GET" }).handler(async () =>
  workerPresenceDetail(await requireAccount()),
);

/**
 * Where this workbench serves the worker package it ships, for `seedctl` to
 * be installed from, or null when it ships none.
 */
export const getWorkerPackagePath = createServerFn({ method: "GET" }).handler(
  async () => {
    const shipped = await shippedWorkerPackage();
    return shipped ? `/worker-package/${shipped.filename}` : null;
  },
);

/**
 * Administrators enroll the shared workers; every account enrolls its own
 * computer as a personal one.
 */
export const createWorker = createServerFn({ method: "POST" })
  .validator(workerEnrollmentRequestSchema)
  .handler(async ({ data }) => {
    if (data.personal)
      return enrollWorker(data.workerId, (await requireAccount()).id);
    await requireAdministrator();
    return enrollWorker(data.workerId, null);
  });

/** Administrators remove any worker; an account removes its own. */
export const removeWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    const user = await requireAccount();
    await (isAdmin(user)
      ? removeWorkerService(data.workerId)
      : removePersonalWorker(user.id, data.workerId));
  });
