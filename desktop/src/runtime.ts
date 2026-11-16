import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { run } from "./commands";
import { HOST_PROTOCOL, type WorkerPackage } from "./workbench";

/**
 * The Worker runtime this app keeps for itself: `seedctl` with its own
 * Python, installed by the `uv` the app carries into a folder of the app's,
 * apart from anything else on the computer.
 */
export class Runtime {
  readonly #root: string;
  readonly #uv: string;
  #active: string | null = null;

  constructor(root: string, uv: string) {
    // A runtime identity also includes the native platform it was resolved for.
    this.#root = path.join(root, `${process.platform}-${process.arch}`);
    this.#uv = uv;
  }

  /** The `seedctl` this runtime installs. */
  get seedctl(): string {
    if (this.#active === null) throw new Error("No Worker runtime is active");
    return path.join(this.#root, "releases", this.#active, "bin", "seedctl");
  }

  get #record(): string {
    return path.join(this.#root, "active-runtime");
  }

  /** The complete runtime identity, not just the wheel digest. */
  async installed(): Promise<string | null> {
    const id = await readFile(this.#record, "utf8").catch(() => null);
    this.#active = id?.trim() || null;
    return this.#active;
  }

  /**
   * Prepares at its final path (venvs cannot move), validates, then atomically
   * switches the launch reference. Failure never mutates the active runtime.
   * The caller has already drained the previous Worker before activating.
   */
  async install(
    shipped: WorkerPackage,
    content: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    const releases = path.join(this.#root, "releases");
    const folder = path.join(releases, shipped.id);
    const file = path.join(folder, shipped.filename);
    if ((await this.installed()) === shipped.id) return;
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    await writeFile(file, content);
    const constraints = path.join(folder, "requirements.txt");
    await writeFile(constraints, shipped.requirements);
    const env = {
      ...process.env,
      UV_TOOL_DIR: path.join(folder, "tools"),
      UV_TOOL_BIN_DIR: path.join(folder, "bin"),
      UV_PYTHON_INSTALL_DIR: path.join(this.#root, "python"),
      UV_CACHE_DIR: path.join(this.#root, "cache"),
      UV_PYTHON_PREFERENCE: "only-managed",
      UV_NO_PROGRESS: "1",
    };
    await run(
      this.#uv,
      [
        "tool",
        "install",
        "--reinstall",
        "--python",
        shipped.python,
        "--constraint",
        constraints,
        `seedctl[yolo] @ ${pathToFileURL(file).href}`,
      ],
      {
        env,
        signal,
      },
    );
    const checked = await run(
      path.join(folder, "bin", "seedctl"),
      ["worker", "runtime"],
      { env, signal },
    );
    if (JSON.parse(checked.stdout)?.hostProtocol !== HOST_PROTOCOL)
      throw new Error(
        "The installed Worker does not implement the declared host protocol",
      );
    signal.throwIfAborted();
    const previous = this.#active;
    await writeFile(`${this.#record}.next`, `${shipped.id}\n`);
    await rename(`${this.#record}.next`, this.#record);
    this.#active = shipped.id;
    // Retain the last good environment; discard only older owned installations.
    for (const id of await readdir(releases)) {
      if (id !== shipped.id && id !== previous)
        await rm(path.join(releases, id), { recursive: true, force: true });
    }
  }
}
