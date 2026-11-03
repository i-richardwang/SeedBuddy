import { createFileRoute } from "@tanstack/react-router";

import { today } from "../domain/experiments/schema";
import {
  experimentWorkbook,
  experimentWorkbookFilename,
} from "../features/experiments/workbook";
import { listModels } from "../server/models/public";
import { experimentGridDetail } from "../server/queries/public";
import { workbookResponse } from "../server/transport/http/workbook";

export const Route = createFileRoute("/experiments/$experiment/workbook")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const grid = await experimentGridDetail(params.experiment);
        if (!grid) return new Response("Not found", { status: 404 });
        const workbook = experimentWorkbook(
          { ...grid, models: await listModels() },
          today(),
        );
        return workbookResponse(
          workbook,
          experimentWorkbookFilename(grid.experiment),
        );
      },
    },
  },
});
