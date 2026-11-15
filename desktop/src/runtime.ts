import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { run } from "./commands";
import type { WorkerPackage } from "./workbench";

/** The Python the Worker runtime is installed on. */
const PYTHON = "3.13";

/**
 * The Worker runtime this app keeps for itself: `seedctl` with its own
 * Python, installed by the `uv` the app carries into a folder of the app's,
 * apart from anything else on the computer.
 */
export class Runtime {
  readonly #root: string;
  readonly #uv: string;

  constructor(root: string, uv: string) {
    this.#root = root;
    this.#uv = uv;
  }

  /** The `seedctl` this runtime installs. */
  get seedctl(): string {
    return path.join(this.#root, "bin", "seedctl");
  }

  get #record(): string {
    return path.join(this.#root, "installed-package");
  }

  /** The digest of the package installed here, or null when none is. */
  async installed(): Promise<string | null> {
    const digest = await readFile(this.#record, "utf8").catch(() => null);
    return digest?.trim() || null;
  }

  /**
   * Installs a package a workbench ships, with the `yolo` extra a Worker
   * detects and trains with, in place of the one installed. Until it is done
   * none counts as installed.
   */
  async install(
    shipped: WorkerPackage,
    content: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    const folder = path.join(this.#root, "package");
    const file = path.join(folder, shipped.filename);
    await rm(this.#record, { force: true });
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    await writeFile(file, content);
    await run(
      this.#uv,
      [
        "tool",
        "install",
        "--reinstall",
        "--python",
        PYTHON,
        `seedctl[yolo] @ ${pathToFileURL(file).href}`,
      ],
      {
        env: {
          ...process.env,
          UV_TOOL_DIR: path.join(this.#root, "tools"),
          UV_TOOL_BIN_DIR: path.join(this.#root, "bin"),
          UV_PYTHON_INSTALL_DIR: path.join(this.#root, "python"),
          UV_CACHE_DIR: path.join(this.#root, "cache"),
          UV_PYTHON_PREFERENCE: "only-managed",
          UV_NO_PROGRESS: "1",
        },
        signal,
      },
    );
    await writeFile(this.#record, `${shipped.digest}\n`);
  }
}
