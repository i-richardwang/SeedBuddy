import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { paraglideOptions } from "./paraglide.config.ts";

export default defineConfig(({ command }) => {
  if (command === "serve")
    process.env.SEEDBUDDY_IMAGE_ANALYSIS_URL ??= new URL(
      "./src/server/images/dish-thread.ts",
      import.meta.url,
    ).href;
  return {
    server: {
      port: 3000,
    },
    plugins: [
      paraglideVitePlugin(paraglideOptions),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/src/server/**", "**/src/server.ts"] },
        },
      }),
      viteReact(),
      tailwindcss(),
    ],
  };
});
