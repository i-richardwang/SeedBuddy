import { createMiddleware } from "@tanstack/react-start";

import { businessFailure, DomainError } from "../domain/errors";

export const mapBusinessErrors = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof DomainError) throw businessFailure(error);
      if (error instanceof Error)
        console.error("Server function failed", error);
      throw error;
    }
  },
);
