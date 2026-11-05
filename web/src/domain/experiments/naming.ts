/**
 * The codes a treatment's replicates take: `T1-1` through `T1-n`, skipping
 * any the experiment already uses so that adding replicates continues the
 * series instead of colliding with it.
 */
export function replicateCodes(
  treatment: string,
  replicates: number,
  taken: readonly string[],
): string[] {
  const used = new Set(taken.map((code) => code.toLowerCase()));
  const codes: string[] = [];
  for (let replicate = 1; codes.length < replicates; replicate += 1) {
    const code = `${treatment}-${replicate}`;
    if (used.has(code.toLowerCase())) continue;
    used.add(code.toLowerCase());
    codes.push(code);
  }
  return codes;
}

/** The filename without its extension, as the camera or the operator wrote it. */
export function filenameStem(filename: string): string {
  const normalized = filename.normalize("NFC").trim();
  const dot = normalized.lastIndexOf(".");
  return (dot > 0 ? normalized.slice(0, dot) : normalized).trim();
}

/** Case and separators are what a camera or an operator varies freely. */
function looseCode(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The unit a filename most likely shows. A stem that matches a
 * code names it outright; otherwise a stem ending in a code after a separator
 * does, which is how `IMG_0413_T1-2` survives a camera.
 */
export function suggestUnit(
  filename: string,
  codes: readonly string[],
): string | null {
  const stem = looseCode(filenameStem(filename));
  if (!stem) return null;
  const exact = codes.filter((code) => looseCode(code) === stem);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const suffixed = codes.filter((code) => stem.endsWith(`-${looseCode(code)}`));
  if (suffixed.length !== 1) return null;
  return suffixed[0]!;
}

/** Camera filenames count up as the shutter fires, so `IMG_0002` precedes `IMG_0010`. */
function compareFilenames(left: string, right: string): number {
  return filenameStem(left).localeCompare(filenameStem(right), "en", {
    numeric: true,
  });
}

/**
 * The units a run of photographs shows when the dishes were shot in design
 * order: the earliest file takes the first open unit, and so on until either
 * runs out.
 */
export function pairInOrder<Id>(
  images: readonly { id: Id; filename: string }[],
  units: readonly string[],
): Map<Id, string> {
  const shot = [...images].sort((left, right) =>
    compareFilenames(left.filename, right.filename),
  );
  const pairs = new Map<Id, string>();
  shot.forEach((image, index) => {
    const unit = units[index];
    if (unit !== undefined) pairs.set(image.id, unit);
  });
  return pairs;
}
