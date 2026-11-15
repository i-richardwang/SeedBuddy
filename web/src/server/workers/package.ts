import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { contentDigest } from "../infra/digest";

const PACKAGE_FOLDER = path.join(process.cwd(), "worker-package");
const WHEEL = /^seedctl-.+\.whl$/;

/**
 * The worker package a workbench ships: the `seedctl` wheel built from the
 * workbench's own source, so a worker installed from it speaks the
 * workbench's protocol revision.
 */
export interface WorkerPackage {
  /** The wheel's file name, which an installer reads its version from. */
  filename: string;
  /** The SHA-256 of the content, as lower-case hex. */
  digest: string;
  content: Uint8Array<ArrayBuffer>;
}

/**
 * The one `seedctl` wheel a folder holds, or null when the folder is absent
 * or holds none: a deployment built without it ships no worker package.
 */
export async function readWorkerPackage(
  folder: string,
): Promise<WorkerPackage | null> {
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const wheels = names.filter((name) => WHEEL.test(name));
  const [filename] = wheels;
  if (filename === undefined) return null;
  if (wheels.length > 1)
    throw new Error(
      `${folder} holds ${wheels.length} worker packages; a workbench ships one`,
    );
  const content = new Uint8Array(await readFile(path.join(folder, filename)));
  return { filename, digest: contentDigest(content), content };
}

let shipped: Promise<WorkerPackage | null> | undefined;

/**
 * The worker package this workbench ships, or null when it ships none. The
 * image holds it for its lifetime, so it is read once.
 */
export function shippedWorkerPackage(): Promise<WorkerPackage | null> {
  shipped ??= readWorkerPackage(PACKAGE_FOLDER).catch((error) => {
    shipped = undefined;
    throw error;
  });
  return shipped;
}
