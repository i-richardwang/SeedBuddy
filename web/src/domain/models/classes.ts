import { z } from "zod";

import { UnknownClassError } from "./errors";

const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Use lower_snake_case");

export const classNameSchema = identifierSchema;

export const classListSchema = z
  .array(classNameSchema)
  .min(1)
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
 * Whether the classes a count sums are every class its model finds, or
 * narrow it to some of them.
 */
export function countsEveryClass(
  counted: readonly string[],
  modelClasses: readonly string[],
): boolean {
  return counted.length === modelClasses.length;
}

/**
 * Each class keeps one color wherever its boxes are drawn, for the people who
 * review them and the agents that propose them alike, taken in the order
 * its model declares its classes.
 */
const CLASS_COLORS = [
  { name: "blue", hex: "#3b82f6" },
  { name: "magenta", hex: "#d946ef" },
  { name: "green", hex: "#22c55e" },
] as const;

export type ClassColor = (typeof CLASS_COLORS)[number];

export function classColor(
  classes: readonly string[],
  name: string,
): ClassColor {
  return CLASS_COLORS[classes.indexOf(name) % CLASS_COLORS.length]!;
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
    throw new UnknownClassError(
      `${context} uses unknown ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
}
