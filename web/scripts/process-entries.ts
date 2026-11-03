/** Each process entry and whether Bun bundles it directly or Vite supplies it. */
export const PROCESS_ENTRIES = [
  { path: "server.ts", bundle: true },
  { path: "scripts/collect-blobs.ts", bundle: true },
  { path: "scripts/maintenance.ts", bundle: true },
  { path: "scripts/analyze-images.ts", bundle: true },
  { path: "src/server/images/dish-thread.ts", bundle: true },
  { path: "src/server.ts", bundle: false },
] as const;
