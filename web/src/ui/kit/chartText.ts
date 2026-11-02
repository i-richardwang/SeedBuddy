/*
 * Measuring the charts' labels, which are set at the axis label size (12px,
 * `--text-xs`) in the page font, so an axis can be as wide as its widest
 * value and a category label as long as its slot.
 */

const ELLIPSIS = "…";
const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

/** Width of `text` at the label size, cached per text. */
export function textWidth(text: string): number {
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  if (context === undefined)
    context = document.createElement("canvas").getContext("2d");
  if (!context) return 0;
  context.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  const width = context.measureText(text).width;
  widths.set(text, width);
  return width;
}

/**
 * `text` as far as fits in `width`, cut with an ellipsis when it does not and
 * nothing when not even its first character does. Whole on the server, where
 * nothing can be measured.
 */
export function fitText(text: string, width: number): string {
  if (typeof document === "undefined" || textWidth(text) <= width) return text;
  const characters = Array.from(text);
  for (let length = characters.length - 1; length > 0; length -= 1) {
    const cut = characters.slice(0, length).join("") + ELLIPSIS;
    if (textWidth(cut) <= width) return cut;
  }
  return "";
}
