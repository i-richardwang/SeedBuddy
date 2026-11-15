import { getWorkerPackagePath } from "../../functions/workers";

/**
 * The command that installs `seedctl` on a Worker from the package this
 * workbench ships, replacing the one already installed, or null when the
 * workbench ships none.
 */
export async function readWorkerInstallCommand(): Promise<string | null> {
  const packagePath = await getWorkerPackagePath();
  return packagePath === null
    ? null
    : `uv tool install --reinstall 'seedctl[yolo] @ ${window.location.origin}${packagePath}'`;
}

/** The command that sets a computer up as a Worker enrolled on this workbench. */
export function workerSetupCommand(workerId: string): string {
  return `seedctl worker setup ${workerId} --server ${window.location.origin}`;
}
