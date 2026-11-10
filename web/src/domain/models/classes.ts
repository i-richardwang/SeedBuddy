import { z } from "zod";

import { ClassInvalidError } from "./errors";

export const classNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Use lower_snake_case");

/**
 * Each class keeps one color wherever its boxes are drawn, for the people who
 * review them and the agents that propose them alike, taken in the order
 * its model declares its classes. A model declares no more classes than
 * there are colors, so no two of its classes are ever drawn alike.
 */
const CLASS_COLORS = [
  { name: "blue", hex: "#3b82f6" },
  { name: "magenta", hex: "#d946ef" },
  { name: "green", hex: "#22c55e" },
  { name: "orange", hex: "#f97316" },
  { name: "cyan", hex: "#22d3ee" },
  { name: "yellow", hex: "#facc15" },
] as const;

type ClassColor = (typeof CLASS_COLORS)[number];

export const MAX_CLASSES = CLASS_COLORS.length;

export const classListSchema = z
  .array(classNameSchema)
  .min(1)
  .max(MAX_CLASSES, `A model declares at most ${MAX_CLASSES} classes`)
  .superRefine((classes, context) => {
    if (new Set(classes).size !== classes.length) {
      context.addIssue({ code: "custom", message: "Classes must be unique" });
    }
  })
  .meta({ uniqueItems: true });

/**
 * Instances per class in one observation image, keyed by whatever a model calls
 * its classes. A tally holds nothing but the classes counted, and a class
 * absent from it was counted zero times, whatever that class is named.
 */
export const tallySchema = z.record(z.string(), z.number().int().min(0));

export type Tally = z.infer<typeof tallySchema>;

export function classCount(counts: Tally, name: string): number {
  return Object.hasOwn(counts, name) ? counts[name] : 0;
}

export function tally(instances: readonly { class: string }[]): Tally {
  const counts: Tally = Object.create(null);
  for (const instance of instances) {
    counts[instance.class] = classCount(counts, instance.class) + 1;
  }
  return counts;
}

/** How many instances of the named classes a tally holds, together. */
export function countClasses(counts: Tally, names: readonly string[]): number {
  return names.reduce((sum, name) => sum + classCount(counts, name), 0);
}

/** Whether two lists name the same classes in the same order. */
export function sameClasses(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

/**
 * The classes of a model that `names` names, in the order the model declares
 * them; a name the model does not declare is refused.
 */
export function chosenClasses(
  modelClasses: readonly string[],
  names: readonly string[],
): string[] {
  const unknown = names.filter((name) => !modelClasses.includes(name));
  if (unknown.length > 0) {
    throw new ClassInvalidError(
      `The model does not recognize ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
  return modelClasses.filter((name) => names.includes(name));
}

/**
 * Whether `some` are classes of a model, named in the order it declares
 * them: what a version finds, what a day counts by default, or what a
 * dataset was annotated with.
 */
export function classesAmong(
  some: readonly string[],
  modelClasses: readonly string[],
): boolean {
  return sameClasses(
    modelClasses.filter((name) => some.includes(name)),
    some,
  );
}

/**
 * The classes a model declares that a version finding `found` does not, in
 * the model's order. What the version reads holds none of them.
 */
export function unfoundClasses(
  modelClasses: readonly string[],
  found: readonly string[],
): string[] {
  return modelClasses.filter((name) => !found.includes(name));
}

/**
 * Whether the classes a count sums are every class its model finds, or
 * narrow it to some of them.
 */
export function countsEveryClass(
  counted: readonly string[],
  modelClasses: readonly string[],
): boolean {
  return counted.length === modelClasses.length;
}

export function classColor(
  classes: readonly string[],
  name: string,
): ClassColor {
  const color = CLASS_COLORS[classes.indexOf(name)];
  if (!color) throw new Error(`${name} is not a class of the model`);
  return color;
}

export function assertInstanceClasses(
  classes: readonly string[],
  instances: readonly { class: string }[],
  context: string,
): void {
  const known = new Set(classes);
  const unknown = [
    ...new Set(instances.map((instance) => instance.class)),
  ].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new ClassInvalidError(
      `${context} uses unknown ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
}
