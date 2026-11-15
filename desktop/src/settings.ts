import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** What the app keeps between launches. */
export interface Settings {
  /** The origin of the workbench the app opens, or null until one is chosen. */
  server: string | null;
  /** The name this computer serves under as a Worker. */
  workerName: string;
  /** Whether the Worker profile holds a token the workbench issued it. */
  enrolled: boolean;
  /** Whether this computer serves as a Worker while the app runs. */
  serving: boolean;
}

function isSettings(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null) return false;
  const { server, workerName, enrolled, serving } = value as Record<
    string,
    unknown
  >;
  return (
    (server === null || typeof server === "string") &&
    typeof workerName === "string" &&
    typeof enrolled === "boolean" &&
    typeof serving === "boolean"
  );
}

/** The settings a file holds, or `initial` when it holds none that read. */
export async function readSettings(
  file: string,
  initial: () => Settings,
): Promise<Settings> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return initial();
  try {
    const value: unknown = JSON.parse(text);
    return isSettings(value) ? value : initial();
  } catch {
    return initial();
  }
}

/** Replaces the file whole, so a crash never leaves half a document. */
export async function writeSettings(
  file: string,
  settings: Settings,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(partial, file);
}
