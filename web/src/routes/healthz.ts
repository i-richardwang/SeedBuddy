import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../domain/models/builtins";
import { reachBlobStore } from "../server/infra/blobs/store";
import { database } from "../server/infra/db/client";
import { readModelVersion } from "../server/models/public";

/**
 * Succeeds while the database answers with its builtin models in place and
 * the blob store answers. The server refuses to start until this passes, so
 * a deployment reads what is wrong from the check that refused it.
 */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const db = await database();
          await db.execute(sql`select 1`);
          if (
            !(await readModelVersion(SEED_DETECTOR_BASELINE_VERSION_ID, db))
          ) {
            throw new Error(
              `Builtin version ${SEED_DETECTOR_BASELINE_VERSION_ID} is missing`,
            );
          }
          await reachBlobStore();
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 503 },
          );
        }
        return new Response("ok");
      },
    },
  },
});
