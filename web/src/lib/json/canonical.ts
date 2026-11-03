/** Sort keys by code unit, independent of locale. Application-generated digest documents use ASCII identifier keys; imported record keys follow the same code-unit ordering. */
export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(
            ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
          ),
        )
      : item,
  );
  if (encoded === undefined)
    throw new TypeError("Value is not JSON-serializable");
  return encoded;
}
