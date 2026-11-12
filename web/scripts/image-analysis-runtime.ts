/** Bundled entry points and their image-analysis worker live in the same directory. */
process.env.SEEDBUDDY_IMAGE_ANALYSIS_URL ??= new URL(
  "./dish-thread.js",
  import.meta.url,
).href;
