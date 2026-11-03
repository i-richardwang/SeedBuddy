import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Point } from "../../domain/annotation/geometry";
import type { ImageSize } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";
import { Button } from "../kit/Button";
import { Text } from "../kit/Text";
import { Toolbar, ToolbarSeparator } from "../kit/Toolbar";
import { formatPercent } from "../numbers";
import { loadPicture, pictureSrc, previewSrc } from "./picture";
import {
  FILL,
  focusedOn,
  pannedTo,
  placedView,
  type RelativeView,
  relativeView,
  resolveView,
  type Size,
  type View,
  type ViewIntent,
  zoomedAbout,
} from "./viewport";

const ZOOM_PER_WHEEL_PIXEL = 0.0015;
const CLICK_SLOP = 3;

interface ScreenPoint {
  clientX: number;
  clientY: number;
}

/** What a layer drawn over the image needs from the viewport around it. */
interface ViewportHandle {
  /** Screen pixels per image pixel. */
  scale: number;
  toImagePoint: (event: ScreenPoint) => Point;
  /** Offset to hold between the pointer and the image while dragging. */
  panOrigin: (event: ScreenPoint) => Point;
  panTo: (x: number, y: number) => void;
}

const ViewportContext = createContext<ViewportHandle | null>(null);

export function useViewport(): ViewportHandle {
  const handle = use(ViewportContext);
  if (!handle) throw new Error("useViewport requires ImageViewport");
  return handle;
}

interface Drag {
  pointerId: number;
  origin: Point;
  start: ScreenPoint;
  moved: boolean;
}

/**
 * Drag to pan; release without moving to press. Attached to whichever
 * surface owns the pointer: the frame itself, or a layer over the image.
 */
export function usePanGesture(
  viewport: ViewportHandle,
  onPress?: (point: Point) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  return {
    dragging: drag?.moved === true,
    onPointerDown(event: React.PointerEvent) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        pointerId: event.pointerId,
        origin: viewport.panOrigin(event),
        start: { clientX: event.clientX, clientY: event.clientY },
        moved: false,
      });
    },
    onPointerMove(event: React.PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved =
        drag.moved ||
        Math.hypot(
          event.clientX - drag.start.clientX,
          event.clientY - drag.start.clientY,
        ) > CLICK_SLOP;
      if (!moved) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      viewport.panTo(
        event.clientX - drag.origin.x,
        event.clientY - drag.origin.y,
      );
    },
    onPointerUp(event: React.PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDrag(null);
      if (!drag.moved) onPress?.(viewport.toImagePoint(event));
    },
    onPointerCancel(event: React.PointerEvent) {
      if (drag?.pointerId === event.pointerId) setDrag(null);
    },
  };
}

/**
 * Whether a picture has arrived and can be painted at once. It is fetched
 * from the moment it is asked for, and given up when another takes its place.
 */
function usePictureArrived(digest: string): boolean {
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    const picture = loadPicture(pictureSrc(digest));
    let wanted = true;
    void picture.ready.then((ready) => {
      if (ready && wanted) setArrived(digest);
    });
    return () => {
      wanted = false;
      picture.release();
    };
  }, [digest]);
  return arrived === digest;
}

/** A region of the image to bring into view; a new `key` brings it again. */
export interface ViewportFocus {
  key: string;
  region: { x: number; y: number; width: number; height: number };
}

/** A view held outside the viewport, so that viewports given the same one move together. */
export interface ViewportLink {
  view: RelativeView;
  onChange: (update: (view: RelativeView) => RelativeView) => void;
}

/**
 * One image covering a frame until zoomed. Wheel zooms about the cursor,
 * dragging pans, and the image re-covers the frame whenever it changes size.
 * The view is held relative to the image, by the viewport itself or, with
 * `link`, by the caller, so photographs of the same subject in viewports
 * given one link zoom and pan as one, each in its own frame.
 * Its preview stands in for it from the first frame, and the image is laid
 * over the preview as soon as it has arrived.
 * Children are drawn over the image in image pixels. `focus` centers a region
 * when it changes; `controls` join the zoom in the corner toolbar. While
 * `pending`, another image is on its way and this one steps back if the wait
 * grows long enough to notice.
 */
export function ImageViewport({
  image,
  filename,
  focus,
  pending = false,
  link,
  controls,
  children,
}: {
  image: ImageSize & { digest: string };
  filename: string;
  focus?: ViewportFocus | null;
  pending?: boolean;
  link?: ViewportLink;
  controls?: ReactNode;
  children?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [ownView, setOwnView] = useState<RelativeView>(FILL);
  const relative = link?.view ?? ownView;
  const onRelativeChange = link?.onChange ?? setOwnView;
  const { width, height } = image;
  const arrived = usePictureArrived(image.digest);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const view = useMemo(
    () => placedView(relative, frame, size),
    [relative, frame, size],
  );
  // Each change is made to the latest view held, so wheel events arriving
  // faster than the frames between them all count.
  const change = useCallback(
    (update: (current: View) => ViewIntent) => {
      if (!frame) return;
      onRelativeChange((previous) =>
        relativeView(
          resolveView(update(placedView(previous, frame, size)), frame, size),
          frame,
          size,
        ),
      );
    },
    [onRelativeChange, frame, size],
  );

  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () =>
      setFrame({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = frameRef.current;
    if (!element || !frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      change((current) =>
        zoomedAbout(
          current,
          anchor,
          current.scale * Math.exp(-event.deltaY * ZOOM_PER_WHEEL_PIXEL),
          frame,
          size,
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [frame, size, change]);

  const focusKey = focus?.key;
  const focusRegion = useEffectEvent(() => {
    if (focus && frame) change(() => focusedOn(focus.region, frame, size));
  });
  const measured = frame !== null;
  useEffect(() => {
    if (focusKey !== undefined && measured) focusRegion();
  }, [focusKey, measured]);

  const panTo = useCallback(
    (x: number, y: number) => change((current) => pannedTo(current, x, y)),
    [change],
  );
  const handle = useMemo<ViewportHandle>(
    () => ({
      scale: view.scale,
      toImagePoint: (event) => {
        const rect = frameRef.current!.getBoundingClientRect();
        return {
          x: (event.clientX - rect.left - view.x) / view.scale,
          y: (event.clientY - rect.top - view.y) / view.scale,
        };
      },
      panOrigin: (event) => ({
        x: event.clientX - view.x,
        y: event.clientY - view.y,
      }),
      panTo,
    }),
    [view, panTo],
  );
  const pan = usePanGesture(handle);

  return (
    <div
      ref={frameRef}
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden select-none"
      style={{ cursor: pan.dragging ? "grabbing" : "grab" }}
      onPointerDown={pan.onPointerDown}
      onPointerMove={pan.onPointerMove}
      onPointerUp={pan.onPointerUp}
      onPointerCancel={pan.onPointerCancel}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width,
          height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          opacity: pending ? 0.6 : 1,
          transition: "opacity var(--duration-slow) var(--ease-out)",
          transitionDelay: pending ? "var(--duration-slow)" : "0s",
        }}
      >
        <img
          src={previewSrc(image.digest)}
          alt={filename}
          width={width}
          height={height}
          decoding="sync"
          draggable={false}
          className="block h-full w-full"
        />
        {arrived ? (
          <img
            src={pictureSrc(image.digest)}
            alt=""
            width={width}
            height={height}
            decoding="sync"
            draggable={false}
            className="absolute inset-0 h-full w-full"
          />
        ) : null}
        <ViewportContext value={handle}>{children}</ViewportContext>
      </div>
      <Toolbar
        aria-label={m.ui_viewport_zoom()}
        className="absolute right-3 bottom-3"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Text
          as="span"
          size="xs"
          type="secondary"
          className="w-12 text-center tabular-nums"
        >
          {formatPercent(view.scale)}
        </Text>
        <Button
          type="text"
          size="small"
          disabled={view.filled}
          onClick={() => change(() => FILL)}
        >
          {m.ui_viewport_fill()}
        </Button>
        {controls ? (
          <>
            <ToolbarSeparator />
            {controls}
          </>
        ) : null}
      </Toolbar>
    </div>
  );
}
