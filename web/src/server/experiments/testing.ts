import { makeResult } from "../../domain/annotation/testing";
import type { ModelVersion } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { FIXTURE_EDGE } from "../testing/images";
import { trainingHeartbeat, ULTRALYTICS_RUNTIME } from "../testing/workers";

export const worker: Worker = {
  ...trainingHeartbeat(
    { workerId: "ultralytics-worker", sessionId: "session-ultralytics-worker" },
    new Date("2026-08-27T00:00:00.000Z"),
  ),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

export function countedImageResult(
  version: ModelVersion,
  digest: string,
  seeds: number,
) {
  return {
    ...makeResult(
      Array.from({ length: seeds }, (_, id) => ({
        id,
        x: 12 + id * 14,
        y: 12,
      })),
      { digest, dishRadius: 400, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    ),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
  };
}
