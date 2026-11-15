import type { Fetch } from "./workbench";

/** A published version of the app, and the page that offers it. */
export interface Release {
  version: string;
  page: string;
}

/** The repository whose releases carry the app, each tagged `desktop-v<version>`. */
const REPOSITORY = "i-richardwang/SeedBuddy";
const TAG = /^desktop-v(\d+\.\d+\.\d+)$/;
const ANSWER_MS = 10_000;

/** Orders versions by their numbers, so that 0.10.0 comes after 0.9.0. */
const order = new Intl.Collator("en", { numeric: true });

/** The version a published release carries; none for a draft, a pre-release or anything else. */
function versionOf(release: unknown): string | null {
  if (typeof release !== "object" || release === null) return null;
  const { tag_name, draft, prerelease } = release as Record<string, unknown>;
  if (typeof tag_name !== "string" || draft === true || prerelease === true)
    return null;
  return TAG.exec(tag_name)?.[1] ?? null;
}

/**
 * The latest release of the app that comes after the version `current`, or
 * null when there is none or the releases cannot be read: the app only
 * offers a release, so not knowing of one costs nothing.
 */
export async function newerRelease(
  fetch: Fetch,
  current: string,
): Promise<Release | null> {
  const releases: unknown = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`,
    {
      headers: { accept: "application/vnd.github+json" },
      credentials: "omit",
      signal: AbortSignal.timeout(ANSWER_MS),
    },
  )
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!Array.isArray(releases)) return null;
  let latest = current;
  for (const release of releases) {
    const version = versionOf(release);
    if (version !== null && order.compare(version, latest) > 0)
      latest = version;
  }
  return latest === current
    ? null
    : {
        version: latest,
        page: `https://github.com/${REPOSITORY}/releases/tag/desktop-v${latest}`,
      };
}
