import { expect } from "bun:test";
import { isNotFound } from "@tanstack/react-router";
export type RouteLoader = (context: {
  params: Record<string, string>;
  deps: Record<string, unknown>;
}) => unknown | Promise<unknown>;

export async function expectNotFound(
  loader: RouteLoader,
  params: Record<string, string>,
  deps: Record<string, unknown> = {},
) {
  try {
    await loader({ params, deps });
    throw new Error("Expected route loader to throw notFound");
  } catch (cause) {
    expect(isNotFound(cause)).toBeTrue();
  }
}
