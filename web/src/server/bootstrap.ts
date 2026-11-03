import { configureDatabase } from "./infra/db/client";
import { connect } from "./infra/db/connection";
import { prepareDatabase } from "./models/public";

/** Wire application initialization once per entry point; opening remains lazy and retryable. */
export function bootstrap(): void {
  configureDatabase(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return prepareDatabase(await connect(url));
  });
}
