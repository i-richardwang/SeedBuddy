import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z, type ZodType } from "zod";

import { trainingParametersSchema } from "../src/domain/training/parameters";
import { annotationSchema } from "../src/domain/annotation/schema";
import { datasetManifestSchema } from "../src/domain/datasets/manifest";
import { detectionResultSchema } from "../src/domain/detection/schema";
import {
  inferenceAssignmentSchema,
  inferenceModelManifestSchema,
} from "../src/domain/inference/assignments";
import {
  datasetSnapshotSchema,
  trainingRunSchema,
  trainingRecipeSchema,
} from "../src/domain/training/schema";

import { dishRecipeSchema } from "../src/domain/images/coverage";
import { modelBundleSchema } from "../src/domain/models/bundle";

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
  ["training-recipe", trainingRecipeSchema],
  ["training-snapshot", datasetSnapshotSchema],
];

await mkdir(OUTPUT, { recursive: true });
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
