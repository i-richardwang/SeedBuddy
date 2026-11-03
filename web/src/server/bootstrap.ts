import { configureDatabase } from "./infra/db/client";
import { type Connection, connect } from "./infra/db/connection";
import { installBuiltinModels } from "./models/public";

/**
 * Prepare one connection for the application. Connection setup owns the
 * resource until both schema migration and builtin registration succeed.
 */
export async function prepareDatabase(
  connection: Connection,
): Promise<Connection> {
  try {
    await connection.migrate();
    await installBuiltinModels(connection.db);
  } catch (error) {
    await connection.close();
    throw error;
  }
  return connection;
}

/** Wire application initialization once per entry point; opening remains lazy and retryable. */
export function bootstrap(): void {
  configureDatabase(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return prepareDatabase(await connect(url));
  });
}
