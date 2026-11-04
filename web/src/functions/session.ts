import { createServerFn } from "@tanstack/react-start";

import { requireAccount } from "./access";

/** The signed-in account. The request middleware admits no session-less call. */
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    return { user: await requireAccount() };
  },
);
