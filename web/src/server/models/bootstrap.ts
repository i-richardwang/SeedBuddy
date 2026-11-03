import type { Connection } from "../infra/db/connection";
import { installBuiltinModels } from "./registry";

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
