import { resolve } from "node:path";

import { PROCESS_ENTRIES } from "./process-entries";

const root = resolve(import.meta.dir, "..");
const vite = Bun.spawn(["bun", "x", "vite", "build"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (await vite.exited) process.exit(1);
const result = await Bun.build({
  entrypoints: PROCESS_ENTRIES.filter((entry) => entry.bundle).map((entry) =>
    resolve(root, entry.path),
  ),
  outdir: resolve(root, "dist"),
  naming: "[name].[ext]",
  target: "bun",
  packages: "external",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
