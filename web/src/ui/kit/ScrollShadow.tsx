import {
  type ComponentProps,
  type CSSProperties,
  type ElementType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";
import { mergeRefs } from "./refs";

interface ScrollShadowProps extends ComponentProps<"div"> {
  as?: ElementType;
  /** Fade length as a percentage of the box. */
  size: number;
}

/** Pixels scrolled before an edge counts as overflowing. */
const OFFSET = 8;

type Edges = { top: boolean; bottom: boolean };

const POSITION = {
  bottom: "ui-scroll-shadow-bottom-shadow",
  top: "ui-scroll-shadow-top-shadow",
  "top-bottom": "ui-scroll-shadow-top-bottom-shadow",
} as const;

/**
 * Which edges have content hidden past them, measured on scroll, window
 * resize and box resize. State changes only when an edge flips; new children
 * re-measure because they can resize the content without resizing the box.
 */
export function useScrollEdges(
  element: { current: HTMLElement | null },
  children: unknown,
) {
  const [edges, setEdges] = useState<Edges>({ top: false, bottom: false });

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const check = () => {
      const overflowing = node.scrollHeight > node.clientHeight;
      const top = overflowing && node.scrollTop > OFFSET;
      const bottom =
        overflowing &&
        node.scrollTop + node.clientHeight < node.scrollHeight - OFFSET;
      setEdges((current) =>
        current.top === top && current.bottom === bottom
          ? current
          : { top, bottom },
      );
    };
    check();
    node.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      observer.disconnect();
    };
  }, [element, children]);

  return edges;
}

/** Vertical scroll container that fades the edges with hidden content past them. */
export function ScrollShadow({
  as: Container = "div",
  className,
  children,
  size,
  style,
  ref,
  ...rest
}: ScrollShadowProps) {
  const domRef = useRef<HTMLDivElement | null>(null);
  const setRefs = useMemo(() => mergeRefs([domRef, ref]), [ref]);
  const edges = useScrollEdges(domRef, children);

  const position =
    edges.top && edges.bottom
      ? "top-bottom"
      : edges.top
        ? "top"
        : edges.bottom
          ? "bottom"
          : null;

  return (
    <Container
      className={cn(
        "ui-scroll-shadow",
        position && POSITION[position],
        className,
      )}
      ref={setRefs}
      style={
        { "--ui-scroll-shadow-size": `${size}%`, ...style } as CSSProperties
      }
      {...rest}
    >
      {children}
    </Container>
  );
}
