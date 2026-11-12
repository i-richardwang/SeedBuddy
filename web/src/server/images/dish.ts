import { Worker } from "node:worker_threads";

import { z } from "zod";

import {
  type DishCircle,
  dishCircleSchema,
} from "../../domain/images/coverage";
import { createWorkGate } from "../../lib/async/work";
import type { DishRequest } from "./dish-recipe";

const responseSchema = z.union([
  z.strictObject({ circle: dishCircleSchema.nullable() }),
  z.strictObject({ error: z.string() }),
]);

/** One lazy runtime per server; only thumbnail pixels cross the thread boundary. */
export function createDishDetector() {
  const compute = createWorkGate(1);
  let worker: Worker | null = null;
  return {
    detect(request: DishRequest): Promise<DishCircle | null> {
      return compute(
        () =>
          new Promise((resolve, reject) => {
            if (!worker) {
              const configured = process.env.SEEDBUDDY_IMAGE_ANALYSIS_URL
                ? new URL(process.env.SEEDBUDDY_IMAGE_ANALYSIS_URL)
                : null;
              if (!configured) {
                reject(new Error("SEEDBUDDY_IMAGE_ANALYSIS_URL is required"));
                return;
              }
              const created = new Worker(configured);
              const forget = () => {
                if (worker === created) worker = null;
              };
              created.on("error", forget);
              created.on("exit", forget);
              worker = created;
            }
            const thread = worker;
            thread.ref();
            const timer = setTimeout(
              () => fail(new Error("Dish analysis timed out")),
              30_000,
            );
            const cleanup = () => {
              clearTimeout(timer);
              thread.off("message", receive);
              thread.off("error", fail);
              thread.off("exit", exited);
              thread.unref();
            };
            const fail = (error: Error) => {
              cleanup();
              worker = null;
              void thread.terminate();
              reject(error);
            };
            const exited = (code: number) =>
              fail(new Error(`Dish analysis exited (${code})`));
            const receive = (value: unknown) => {
              const response = responseSchema.safeParse(value);
              if (!response.success) {
                fail(new Error("Invalid dish analysis response"));
                return;
              }
              if ("error" in response.data) {
                fail(new Error(response.data.error));
                return;
              }
              cleanup();
              resolve(response.data.circle);
            };
            thread.once("message", receive);
            thread.once("error", fail);
            thread.once("exit", exited);
            const pixels = new Uint8Array(request.pixels);
            try {
              thread.postMessage({ ...request, pixels }, [pixels.buffer]);
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
            }
          }),
      );
    },
    async close() {
      await compute(async () => {
        if (worker) await worker.terminate();
        worker = null;
      });
    },
  };
}

export const detectDish = createDishDetector().detect;
