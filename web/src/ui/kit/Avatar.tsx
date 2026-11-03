/** A person's initials: the first letter of each of their first two words. */
export function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="ui-avatar">
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => Array.from(word)[0] ?? "")
        .join("")
        .toUpperCase()}
    </span>
  );
}
