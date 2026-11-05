import { expect, test } from "bun:test";

import { database } from "../infra/db/client";
import { agentProposal } from "../testing/annotation";
import { observedTwice } from "../testing/experiments";
import { imageDigest } from "../testing/images";
import { seedInferenceTaskFailure } from "../testing/inference";
import { experimentProgressDetail } from "./experiment-progress-detail";
import { listImageCells } from "./experiment-records";

test("a photograph waits exactly while its state is pending", async () => {
  const { experiment, first, version } = await observedTwice("Progress states");
  const failed = await imageDigest("Progress states-a2");
  const proposed = await imageDigest("Progress states-b1");
  await seedInferenceTaskFailure(
    { versionId: version.id, digest: failed },
    "unreadable",
  );
  await agentProposal({ digest: proposed, modelId: first.modelId });
  const db = await database();
  const cells = await listImageCells(experiment.id, db, { units: "all" });
  expect(
    Object.fromEntries(cells.map((cell) => [cell.digest, cell.state])),
  ).toMatchObject({
    [failed]: "failed",
    [proposed]: "proposed",
  });
  // Of the three photographs, A-1 is read, A-2 failed and B-1 proposed.
  expect(await experimentProgressDetail(experiment.id)).toEqual({
    photographs: cells.length,
    waiting: cells.filter((cell) => cell.state === "pending").length,
  });
  expect(await experimentProgressDetail(experiment.id)).toEqual({
    photographs: 3,
    waiting: 0,
  });
  expect(await experimentProgressDetail(crypto.randomUUID())).toBeNull();
});
