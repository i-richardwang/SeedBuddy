import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ZodType, z } from "zod";

import { annotationSchema } from "../src/domain/annotation/schema";
import { datasetManifestSchema } from "../src/domain/datasets/manifest";
import { detectionResultSchema } from "../src/domain/detection/schema";
import { dishRecipeSchema } from "../src/domain/images/coverage";
import {
  inferenceAssignmentSchema,
  inferenceModelManifestSchema,
} from "../src/domain/inference/assignments";
import { modelBundleSchema } from "../src/domain/models/bundle";
import { trainingParametersSchema } from "../src/domain/training/parameters";
import {
  datasetSnapshotSchema,
  trainingEpochReportSchema,
  trainingRecipeSchema,
  trainingRunSchema,
} from "../src/domain/training/schema";
import {
  WORKER_PROTOCOL,
  WORKER_PROTOCOL_HEADER,
} from "../src/domain/workers/protocol";

const OUTPUT = path.resolve(import.meta.dir, "../../src/seedctl/contracts");
const CHECK = process.argv.includes("--check");

const contracts: ReadonlyArray<[string, ZodType]> = [
  ["model-bundle", modelBundleSchema],
  ["dish-recipe", dishRecipeSchema],
  ["annotation", annotationSchema],
  ["training-parameters", trainingParametersSchema],
  ["dataset-manifest", datasetManifestSchema],
  ["inference-assignment", inferenceAssignmentSchema],
  ["inference-model-manifest", inferenceModelManifestSchema],
  ["detection-result", detectionResultSchema],
  ["training-run", trainingRunSchema],
  ["training-epoch-report", trainingEpochReportSchema],
  ["training-recipe", trainingRecipeSchema],
  ["training-snapshot", datasetSnapshotSchema],
];

/** Every generated file by name: the contract schemas and the worker protocol. */
const documents: ReadonlyArray<[string, unknown]> = [
  ...contracts.map(([name, schema]): [string, unknown] => [
    `${name}.schema.json`,
    {
      $id: `https://seedbuddy.local/contracts/${name}.schema.json`,
      ...z.toJSONSchema(schema, { io: "input" }),
    },
  ]),
  [
    "worker-protocol.json",
    { revision: WORKER_PROTOCOL, header: WORKER_PROTOCOL_HEADER },
  ],
];

if (!CHECK) await mkdir(OUTPUT, { recursive: true });
let stale = false;
for (const [name, document] of documents) {
  const target = path.join(OUTPUT, name);
  const expected = `${JSON.stringify(document, null, 2)}\n`;
  if (!CHECK) {
    await writeFile(target, expected);
    continue;
  }
  const actual = await readFile(target, "utf8").catch(() => "");
  if (actual !== expected) {
    console.error(`${path.relative(process.cwd(), target)} is stale`);
    stale = true;
  }
}
if (stale) process.exitCode = 1;
