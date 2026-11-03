import { bootstrap } from "../src/server/bootstrap";
import {
  IMAGE_ANALYSIS_RETRY_MS,
  refreshImageAnalysis,
} from "../src/server/images/public";
import { closeDatabase } from "../src/server/infra/db/client";

process.env.VITROFLOW_IMAGE_ANALYSIS_URL ??= new URL(
  "./dish-thread.js",
  import.meta.url,
).href;
bootstrap();
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
try {
  const limit = Number(process.argv[2] ?? 100);
  const attemptedBefore = new Date(Date.now() - IMAGE_ANALYSIS_RETRY_MS);
  const total = { examined: 0, completed: 0, failed: 0, skipped: 0 };
  // A fixed cutoff excludes every attempt made by this sweep, including failures.
  while (!stop.signal.aborted) {
    const result = await refreshImageAnalysis({
      limit,
      attemptedBefore,
      signal: stop.signal,
    });
    for (const key of ["examined", "completed", "failed", "skipped"] as const)
      total[key] += result[key];
    if (!result.examined) break;
  }
  console.log(JSON.stringify(total));
  if (total.failed || stop.signal.aborted) process.exitCode = 1;
} finally {
  await closeDatabase();
}
