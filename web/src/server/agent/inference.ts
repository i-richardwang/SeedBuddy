import { z } from "zod";

import { command, query } from "./definition";
import { inferenceTargetSchema } from "../../domain/inference/assignments";
import { inferenceTaskSchema } from "../../domain/inference/tasks";
import { readInferenceTask, retryInferenceTask } from "../inference/public";

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
    name: "retry-inference-task",
    description:
      "Retry a terminally failed inference task with a fresh retry budget; preserves attempt history",
    input: inferenceTargetSchema,
    output: z.null(),
    destructive: true,
    transactional: false,
    handler: (target) => retryInferenceTask(target),
  }),
];
