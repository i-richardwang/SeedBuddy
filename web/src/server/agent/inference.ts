import { z } from "zod";

import { inferenceTargetSchema } from "../../domain/inference/assignments";
import { inferenceTaskSchema } from "../../domain/inference/tasks";
import { readInferenceTask, retryInferenceTask } from "../inference/public";
import { command, query } from "./definition";

export const inferenceOperations = [
  query({
    name: "get-inference-task",
    description:
      "Read an image/version task and its complete execution history",
    input: inferenceTargetSchema,
    output: inferenceTaskSchema.nullable(),
    handler: readInferenceTask,
  }),
  command({
    transaction: "service",
    name: "retry-inference-task",
    description:
      "Retry a terminally failed inference task with a fresh retry budget; preserves attempt history",
    input: inferenceTargetSchema,
    output: z.null(),
    destructive: true,
    handler: (target) => retryInferenceTask(target),
  }),
];
