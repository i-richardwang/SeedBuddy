import { setTimeout as sleep } from "node:timers/promises";

import sharp from "sharp";

import { bootstrap } from "../src/server/bootstrap";
import { refreshImageAnalysis } from "../src/server/images/public";
import { maintainInferenceTasks } from "../src/server/inference/public";
import { closeDatabase } from "../src/server/infra/db/client";
import { collectUnreferencedBlobs } from "../src/server/maintenance/collection";

process.env.VITROFLOW_IMAGE_ANALYSIS_URL ??= new URL(
  "./dish-thread.js",
  import.meta.url,
).href;
sharp.concurrency(1);
bootstrap();

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
const RETRY_INTERVAL_MS = 60 * 1000;

/** Each maintenance responsibility has its own cadence and infrastructure backoff. */
async function repeat(
  name: string,
  interval: number,
  work: () => Promise<void>,
): Promise<void> {
  while (!stop.signal.aborted) {
    let delay = interval;
    try {
      await work();
    } catch (error) {
      delay = RETRY_INTERVAL_MS;
      console.error(`${name} failed`, error);
    }
    try {
      await sleep(delay, undefined, { signal: stop.signal });
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    }
  }
}

try {
  await Promise.all([
    repeat("Inference tasks", 10 * 1000, async () => {
      const expired = await maintainInferenceTasks();
      if (expired) console.log(`Recovered ${expired} inference attempt(s)`);
    }),
    repeat("Blob collection", 60 * 60 * 1000, async () => {
      const { images, modelWeights } = await collectUnreferencedBlobs();
      console.log(
        `Collected ${images.length} image(s) and ${modelWeights.length} model weight object(s)`,
      );
    }),
    repeat("Image analysis", 30 * 1000, async () => {
      const result = await refreshImageAnalysis({
        limit: 2,
        signal: stop.signal,
      });
      if (result.examined) console.log("Image analysis", result);
    }),
  ]);
} finally {
  await closeDatabase();
}
