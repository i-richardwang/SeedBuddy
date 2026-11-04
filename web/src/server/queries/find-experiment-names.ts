import { asc, desc } from "drizzle-orm";

import { snapshot } from "../infra/db/client";
import { experiments } from "../infra/db/schema";

export function findExperimentNames(): Promise<{ id: string; name: string }[]> {
  return snapshot((db) =>
    db
      .select({ id: experiments.id, name: experiments.name })
      .from(experiments)
      .orderBy(
        desc(experiments.createdAt),
        asc(experiments.name),
        asc(experiments.id),
      ),
  );
}
