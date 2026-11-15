/**
 * Builds the app Electron runs: the main process's modules, beside the page
 * and the menu bar icons they load by path.
 */
import { cp, rm } from "node:fs/promises";

const out = "dist";
await rm(out, { recursive: true, force: true });
const built = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: out,
  target: "node",
  format: "esm",
  splitting: true,
  external: ["electron"],
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
await cp("src/connect.html", `${out}/connect.html`);
for (const icon of ["trayTemplate.png", "trayTemplate@2x.png"])
  await cp(`assets/${icon}`, `${out}/${icon}`);
