import {
  WORKER_PROTOCOL,
  WORKER_PROTOCOL_HEADER,
} from "../../../domain/workers/protocol";
import { Route as WorkerApiRoute } from "../../../routes/api.worker";

type Method = "GET" | "POST" | "PUT";
type Handler = (context: never) => Response | Promise<Response>;
type Middleware = {
  options: { server: (context: never) => Promise<unknown> };
};
interface ServerRoute {
  options: { server?: { handlers?: unknown; middleware?: unknown } };
}
interface RouteRequest {
  request: Request;
  params?: Record<string, string>;
}

/** The handler a server route answers `method` with, called directly. */
export function routeHandler(route: ServerRoute, method: Method): Handler {
  const handlers = route.options.server?.handlers as
    Partial<Record<Method, Handler>> | undefined;
  const selected = handlers?.[method];
  if (!selected) throw new Error(`Missing ${method} route handler`);
  return selected;
}

/** A request as a worker process of this workbench's protocol revision sends it. */
export function workerRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(WORKER_PROTOCOL_HEADER, String(WORKER_PROTOCOL));
  return new Request(url, { ...init, headers });
}

/**
 * A worker route as a request reaches it: through the middleware of the
 * worker API's parent route, then the handler with the context it provides.
 */
export function workerRoute(
  route: ServerRoute,
  method: Method,
): (request: RouteRequest) => Promise<Response> {
  const handle = routeHandler(route, method);
  const middleware = (WorkerApiRoute.options.server?.middleware ??
    []) as readonly Middleware[];
  return (request) => {
    const step = async (
      index: number,
      context: Record<string, unknown>,
    ): Promise<Response> => {
      const current = middleware[index];
      if (!current) return handle({ ...request, context } as never);
      return (await current.options.server({
        ...request,
        context,
        next: (result?: { context?: Record<string, unknown> }) =>
          step(index + 1, { ...context, ...result?.context }),
      } as never)) as Response;
    };
    return step(0, {});
  };
}
