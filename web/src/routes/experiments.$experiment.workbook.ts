import { createFileRoute } from "@tanstack/react-router";

import { experimentIdSchema, today } from "../domain/experiments/schema";
import {
  experimentWorkbook,
  experimentWorkbookFilename,
} from "../features/experiments/workbook";
import { listModels } from "../server/models/public";
import { experimentRecordsDetail } from "../server/queries/public";
import { workbookResponse } from "../server/transport/http/workbook";

export const Route = createFileRoute("/experiments/$experiment/workbook")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!experimentIdSchema.safeParse(params.experiment).success)
          return new Response("Not found", { status: 404 });
        const records = await experimentRecordsDetail(params.experiment);
        if (!records) return new Response("Not found", { status: 404 });
        const workbook = experimentWorkbook(
          { ...records, models: await listModels() },
          today(),
        );
        return workbookResponse(
          workbook,
          experimentWorkbookFilename(records.experiment),
        );
      },
    },
  },
});
