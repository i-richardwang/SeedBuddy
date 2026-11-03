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

const OUTPUT = path.resolve(import.meta.dir, "../../src/vitroctl/contracts");
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

if (!CHECK) await mkdir(OUTPUT, { recursive: true });
let stale = false;
for (const [name, schema] of contracts) {
  const target = path.join(OUTPUT, `${name}.schema.json`);
  const document = {
    $id: `https://vitroflow.local/contracts/${name}.schema.json`,
    ...z.toJSONSchema(schema, { io: "input" }),
  };
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
