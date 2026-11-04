import { createFileRoute } from "@tanstack/react-router";

import { archiveFilename } from "../domain/datasets/archive-format";
import { DatasetManifestTooLargeError } from "../domain/datasets/errors";
import { datasetIdSchema } from "../domain/datasets/schema";
import { datasetArchive } from "../server/datasets/public";

export const Route = createFileRoute("/datasets/$dataset/archive")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!datasetIdSchema.safeParse(params.dataset).success) {
          return new Response("Not found", { status: 404 });
        }
        try {
          const found = await datasetArchive(params.dataset);
          if (!found) return new Response("Not found", { status: 404 });
          return new Response(found.archive, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${archiveFilename(found.name)}"`,
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          if (error instanceof DatasetManifestTooLargeError) {
            return new Response(error.message, { status: 422 });
          }
          throw error;
        }
      },
    },
  },
});
