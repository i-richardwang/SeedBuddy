import {
  createMcpHandler,
  McpServer,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import packageJson from "../../../../package.json";
import { readAnnotationReading } from "../../readings/public";
import { classifyAgentFailure } from "../../agent/public";
import { annotationRefSchema } from "../../../domain/annotation/schema";
import { resourceIdSchema } from "../../../domain/identifiers/schema";
import { startAnnotationRunSchema } from "../../../domain/annotation-runs/schema";
import {
  annotationTaskInput,
  annotationPreviewInput,
  annotationSubmitInput,
} from "../../../domain/annotation-runs/tasks";
import {
  createAnnotationRun,
  cancelAnnotationRun,
  nextAnnotationTask,
  readAnnotationContext,
  viewAnnotationTask,
  previewAnnotationTask,
  submitProposal,
  type AnnotationPanel,
} from "../../annotation-runs/public";
import { findImages, listPendingAnnotations } from "../../queries/public";
import { guardMcpRequest, serveAuthorized } from "./access";

const textContent = (value: unknown) => ({
  type: "text" as const,
  text: typeof value === "string" ? value : JSON.stringify(value),
});
const content = (panels: AnnotationPanel[]) =>
  panels.map((panel) =>
    panel.kind === "image"
      ? {
          type: "image" as const,
          data: panel.bytes.toString("base64"),
          mimeType: "image/png",
        }
      : textContent(panel.value),
  );

/** One schema and handler per operation. */
function registerAnnotationTools(server: McpServer) {
  function register<S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    annotations: ToolAnnotations,
    call: (args: z.infer<S>) => Promise<{
      content: (
        | ReturnType<typeof textContent>
        | { type: "image"; data: string; mimeType: string }
      )[];
    }>,
  ) {
    const schema: z.ZodType = inputSchema;
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          destructiveHint: false,
          openWorldHint: false,
          ...annotations,
        },
      },
      async (args) => {
        try {
          return await call(args as z.infer<S>);
        } catch (error) {
          const { code, message } = classifyAgentFailure(error, name);
          return { isError: true, content: [textContent({ code, message })] };
        }
      },
    );
  }
  register(
    "annotation_pending",
    "List images in datasets and experiment observations waiting for AI annotation. Images with a run in progress come first with its progress; continue those with annotation_next. Then come images with neither a reviewer's boxes nor an AI proposal for their model, whose model has annotation instructions. Pass modelId to list one model's images. Returns at most 100 images and the total.",
    z.strictObject({ modelId: resourceIdSchema.optional() }),
    { readOnlyHint: true },
    async (args) => ({
      content: [textContent(await listPendingAnnotations(args.modelId))],
    }),
  );
  register(
    "annotation_find",
    "Find the image a person means by what they see: its filename, with or without the extension, or a link to the workbench page showing it. Returns each match's ref for the other tools, once per model, with the places it is seen: an experiment, unit and observation day, or a dataset. Several matches mean the name is shared; ask the person which place they mean.",
    z.strictObject({ image: z.string().min(1) }),
    { readOnlyHint: true },
    async (args) => ({
      content: [textContent({ images: await findImages(args.image) })],
    }),
  );
  register(
    "annotation_read",
    "Read how an image is currently annotated for a model: the reviewer's boxes, the AI proposal and the detection, in source pixels, which of them the image reads by, and the run in progress with its progress. Start here before starting or continuing a run.",
    z.strictObject({ ref: annotationRefSchema }),
    { readOnlyHint: true },
    async (args) => ({
      content: [textContent(await readAnnotationReading(args.ref))],
    }),
  );
  register(
    "annotation_start",
    "Start an annotation run for an image and model. input is the boxes to begin from: a complete list, the name of a reading annotation_read lists (review, proposal or detection), or null for none. scope limits the run to the regions touched by these source-pixel boxes; regions outside keep the input boxes, so scope needs input. An image has one run in progress at a time; when it already has one, continue it with annotation_next. Results remain unreviewed AI proposals.",
    startAnnotationRunSchema,
    { readOnlyHint: false },
    async (args) => {
      const run = await createAnnotationRun(args);
      return { content: [textContent({ progress: run.progress })] };
    },
  );
  register(
    "annotation_next",
    "Get the next region of the image's run in progress, with progress. It returns the same region until that region is accepted, so the run continues from any conversation. Then view, preview and submit it, and repeat until annotation_submit reports the run succeeded.",
    z.strictObject({ ref: annotationRefSchema }),
    { readOnlyHint: true },
    async (args) => ({
      content: [textContent(await nextAnnotationTask(args.ref))],
    }),
  );
  register(
    "annotation_cancel",
    "Cancel the image's run in progress, discarding its accepted regions, to start again with another input or scope.",
    z.strictObject({ ref: annotationRefSchema }),
    { readOnlyHint: false, destructiveHint: true },
    async (args) => {
      await cancelAnnotationRun(args.ref);
      return { content: [textContent({ cancelled: true })] };
    },
  );
  register(
    "annotation_context",
    "Load the run's shared image overview, classes and rules. Reuse them for regions with the same contextId. Call at conversation start, when contextId changes, or after context loss.",
    annotationTaskInput,
    { readOnlyHint: true },
    async (args) => ({
      content: content(await readAnnotationContext(args.taskId)),
    }),
  );
  register(
    "annotation_view",
    "View one region: CLEAN, optional INITIAL reference boxes, source geometry and contextId. Load annotation_context if its context is not already available. Follow that context's classes and rules.",
    annotationTaskInput,
    { readOnlyHint: true },
    async (args) => {
      return {
        content: content(await viewAnnotationTask(args.taskId)),
      };
    },
  );
  register(
    "annotation_preview",
    "Preview a complete proposal with normalized box_2d edges. Returns CLEAN, PROPOSED and proposalId. Inspect the images before submitting.",
    annotationPreviewInput,
    { readOnlyHint: false },
    async (args) => {
      const { panels, proposalId } = await previewAnnotationTask(args.taskId, {
        instances: args.instances,
      });
      return {
        content: [textContent({ proposalId }), ...content(panels)],
      };
    },
  );
  register(
    "annotation_submit",
    "Accept exactly the previewed proposal. Idempotent for the same proposalId. Accepting the last region completes the run.",
    annotationSubmitInput,
    { readOnlyHint: false, idempotentHint: true },
    async (args) => ({
      content: [
        textContent(await submitProposal(args.taskId, args.proposalId)),
      ],
    }),
  );
}

/**
 * The annotation MCP server: drawing boxes on images, region by region, for
 * the agents people connect.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "vitroflow-annotation", version: packageJson.version },
    {
      instructions:
        "Annotate images for a model by drawing boxes region by region. When a person names an image by its filename or a page link, find it with annotation_find; never ask them for a digest or model id, and when several places match, ask which one by its experiment, unit and day or its dataset. Otherwise find images waiting for annotation with annotation_pending, read one with annotation_read, start or continue its run with annotation_start and annotation_next, then load annotation_context once per conversation and view, preview and submit each region until the run succeeds. Reuse context only while its contextId is unchanged and available; reload after context loss. Results are AI proposals a person reviews.",
    },
  );
  registerAnnotationTools(server);
  return server;
}

const annotationMcpHandler = createMcpHandler(buildServer, {
  legacy: "stateless",
});

/** The annotation server opens to an account's MCP clients and API keys. */
export async function serveAnnotationMcp(request: Request): Promise<Response> {
  return (
    guardMcpRequest(request) ??
    serveAuthorized("annotation", request, (accepted) =>
      annotationMcpHandler.fetch(accepted),
    )
  );
}
