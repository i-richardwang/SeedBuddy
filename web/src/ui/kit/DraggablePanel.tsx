import { motion, useTransform } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import {
  createPanelController,
  type PanelControllerOptions,
} from "./draggablePanelController";

/*
 * A panel at one side of the page, `right` unless placed `left`, resized by
 * dragging its seam. The seam is a separator: drag to resize, double-click
 * to return to `defaultWidth`, arrow keys to step. It draws a 1px stroke
 * unless `border` is off, for a panel the page already frames. Whether it
 * stands open is the caller's to say with `expand`; folded, it leaves no
 * trace in the page.
 */

export type DraggablePanelPlacement = "left" | "right";

const PAN_THRESHOLD = 3;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const useStore = <T,>(
  subscribe: (listener: () => void) => () => void,
  get: () => T,
) => useSyncExternalStore(subscribe, get, get);

export function DraggablePanel({
  "aria-label": ariaLabel,
  border = true,
  children,
  className,
  defaultWidth,
  expand,
  maxWidth,
  minWidth,
  placement = "right",
}: {
  "aria-label": string;
  border?: boolean;
  children: ReactNode;
  className?: string;
  defaultWidth: number;
  expand: boolean;
  maxWidth: number;
  minWidth: number;
  placement?: DraggablePanelPlacement;
}) {
  const contentId = useId();
  const [width, setWidth] = useState(defaultWidth);

  const options: PanelControllerOptions = {
    defaultSize: defaultWidth,
    expand,
    max: maxWidth,
    min: minWidth,
    onSizeChange: setWidth,
    placement,
    size: width,
  };

  const [controller] = useState(() => createPanelController(options));
  const state = useStore(controller.subscribe, () => controller.state);
  // Subscribed, not read: a collapse that changes only the target would otherwise
  // leave the content unclipped and painted outside the zero-width box.
  const target = useStore(controller.subscribe, () => controller.target);
  const elementRef = useRef<HTMLElement>(null);

  useIsomorphicLayoutEffect(() => {
    controller.sync(options);
  });

  useIsomorphicLayoutEffect(() => {
    const node = elementRef.current;
    return node ? controller.attach(node) : undefined;
  }, [controller]);

  const extent = useTransform(controller.motion.size, (value) =>
    Math.max(0, value),
  );
  useEffect(() => () => controller.drag.cancel(), [controller]);

  const pressedRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const clipping = state.dragging || state.folding || target === 0;

  return (
    <aside
      aria-label={ariaLabel}
      className={cn("ui-draggable-panel", className)}
      data-placement={placement}
      ref={elementRef}
    >
      <motion.div
        className="ui-draggable-panel-frame"
        inert={!expand}
        style={{ overflow: clipping ? "clip" : "visible", width: extent }}
      >
        <motion.div
          className="ui-draggable-panel-content"
          id={contentId}
          style={{ width: controller.motion.content }}
        >
          {children}
        </motion.div>
      </motion.div>
      {expand ? (
        // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter; <hr> is a static rule
        <div
          aria-controls={contentId}
          aria-label={m.ui_draggable_panel_resize({ panel: ariaLabel })}
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={target}
          aria-valuetext={m.ui_draggable_panel_size({ size: target })}
          className="ui-draggable-panel-handle"
          data-border={border}
          data-resizing={state.dragging || undefined}
          role="separator"
          tabIndex={0}
          onKeyDown={(event) => controller.resizeByKey(event)}
          onDoubleClick={() => {
            if (!draggedRef.current) controller.reset();
          }}
          // Capture can be stolen mid-drag and the pointerup then never arrives; the
          // pointer is wherever the user last dragged it, so commit rather than snap back.
          onLostPointerCapture={() => {
            if (draggingRef.current) controller.drag.end();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            controller.drag.cancel();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
          onPointerDown={(event) => {
            draggedRef.current = false;
            pressedRef.current = { x: event.clientX, y: event.clientY };
            // A synthetic pointerdown carries no active pointer, and capturing throws.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Nothing to capture.
            }
          }}
          onPointerMove={(event) => {
            if (!pressedRef.current) return;
            const offset = event.clientX - pressedRef.current.x;
            const drift = event.clientY - pressedRef.current.y;
            if (!draggingRef.current) {
              if (Math.hypot(offset, drift) < PAN_THRESHOLD) return;
              draggingRef.current = true;
              draggedRef.current = true;
              controller.drag.start();
            }
            controller.drag.move(offset);
          }}
          onPointerUp={() => {
            if (draggingRef.current) controller.drag.end();
            pressedRef.current = null;
            draggingRef.current = false;
          }}
        />
      ) : null}
    </aside>
  );
}
