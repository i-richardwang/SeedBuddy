/** A model's classes answer to the digit keys, in the order it declares them. */
export function classShortcut(
  classes: readonly string[],
  name: string,
): string | null {
  const index = classes.indexOf(name);
  return classes.length > 1 && index < 9 ? String(index + 1) : null;
}

export function classForShortcut(
  classes: readonly string[],
  key: string,
): string | null {
  return classes.find((name) => classShortcut(classes, name) === key) ?? null;
}

/** The class after this one in the model's order, wrapping around: a pressed box's next state. */
export function nextClass(classes: readonly string[], name: string): string {
  return classes[(classes.indexOf(name) + 1) % classes.length]!;
}
