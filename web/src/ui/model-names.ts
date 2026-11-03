import { m } from "../paraglide/messages";
import type { Model } from "../domain/models/schema";
import { formatList } from "./lists";

/**
 * What the product ships is named by the product, in the reader's language;
 * what a person created keeps the name they gave it.
 */
const BUILTIN_MODEL_NAMES: ReadonlyMap<string, () => string> = new Map([
  ["seed-detector", m.builtin_model_seed_detector],
]);

const BUILTIN_CLASS_NAMES: ReadonlyMap<string, () => string> = new Map([
  ["ungerminated", m.builtin_class_ungerminated],
  ["germinated", m.builtin_class_germinated],
]);

export function modelName(model: Pick<Model, "id" | "name">): string {
  return BUILTIN_MODEL_NAMES.get(model.id)?.() ?? model.name;
}

/** A class the product ships is named by the product; any other keeps its identifier. */
export function classLabel(name: string): string {
  return BUILTIN_CLASS_NAMES.get(name)?.() ?? name;
}

/** The classes a count sums, each named as the reader knows it, in a list of the reader's language. */
export function countedClassesName(names: readonly string[]): string {
  return formatList(names.map(classLabel));
}
