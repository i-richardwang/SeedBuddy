import type { CompilerOptions } from "@inlang/paraglide-js";

/** Options shared by the Vite plugin and the standalone compile script. */
export const paraglideOptions = {
  project: "./project.inlang",
  outdir: "./src/paraglide",
  outputStructure: "message-modules",
  emitTsDeclarations: true,
  cookieName: "seedbuddy_locale",
  strategy: ["cookie", "preferredLanguage", "baseLocale"],
} satisfies CompilerOptions;
