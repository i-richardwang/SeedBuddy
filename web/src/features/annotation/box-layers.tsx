import { useState } from "react";

import {
  initialBoxSide,
  instanceFromBox,
} from "../../domain/annotation/detection";
import {
  boxAround,
  HANDLES,
  type Handle,
  handlePositions,
  moveBox,
  type Point,
  resizeBox,
  sameBox,
} from "../../domain/annotation/geometry";
import type {
  AnnotationInstance,
  ImageSize,
} from "../../domain/annotation/schema";
import type { ImageRectangle } from "../../domain/images/geometry";
import { classColor } from "../../domain/models/classes";
import { usePanGesture, useViewport } from "../../ui/viewport/ImageViewport";
import { nextClass } from "./class-keys";
import { CANVAS_COLORS } from "./colors";
import type { LayerKey } from "./layers";

/** A selected box's corner grips, and the band along each edge that grabs it, in screen pixels. */
const GRIP_SCREEN_SIZE = 6;
const EDGE_GRAB_SCREEN_WIDTH = 8;

/** Lines drawn over the image, in screen pixels: two device pixels on a dense display, one on a standard one. */
const LINE_WIDTH = 1;

/** The other boxes recede while one is selected. */
const UNSELECTED_OPACITY = 0.45;

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

function isHandle(value: string | null): value is Handle {
  return HANDLES.some((handle) => handle === value);
}

/**
 * An overlay drawn in image pixels. Its shapes snap to device pixels, so a
 * line lands whole on the screen's pixels in its full color rather than
 * smeared across two half-tinted ones wherever the view puts it.
 */
function Layer({
  image,
  children,
  ...handlers
}: React.SVGProps<SVGSVGElement> & { image: ImageSize }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${image.width} ${image.height}`}
      className="absolute inset-0 h-full w-full overflow-visible"
      shapeRendering="crispEdges"
      {...handlers}
    >
      {children}
    </svg>
  );
}

/** A box grown by half a line on every side, so its line lies wholly outside it. */
function outside(box: ImageRectangle, line: number): ImageRectangle {
  return {
    x: box.x - line / 2,
    y: box.y - line / 2,
    width: box.width + line,
    height: box.height + line,
  };
}

const CORNERS = ["nw", "ne", "se", "sw"] as const satisfies readonly Handle[];
const EDGES = ["n", "e", "s", "w"] as const satisfies readonly Handle[];

type Corner = (typeof CORNERS)[number];

/** Each edge runs between two corners. */
const EDGE_ENDS: Record<(typeof EDGES)[number], readonly [Corner, Corner]> = {
  n: ["nw", "ne"],
  e: ["ne", "se"],
  s: ["sw", "se"],
  w: ["nw", "sw"],
};

/**
 * A box in its class's color, its line wholly outside it so nothing of the
 * image inside is covered; selected, the line gains a device pixel.
 * With `grips`, a small square at each corner and each edge grabbed anywhere
 * along it resize it, so no grip sits on the outline it frames.
 */
function Box({
  box,
  color,
  ordinal,
  selected = false,
  grips = false,
  cursor,
}: {
  box: ImageRectangle;
  color: string;
  ordinal?: number;
  selected?: boolean;
  grips?: boolean;
  cursor?: string;
}) {
  const { scale, devicePixel } = useViewport();
  const width = selected ? LINE_WIDTH + devicePixel : LINE_WIDTH;
  const drawn = outside(box, width / scale);
  const corners = handlePositions(drawn);
  const grip = GRIP_SCREEN_SIZE / scale;
  return (
    <>
      <rect
        x={drawn.x}
        y={drawn.y}
        width={drawn.width}
        height={drawn.height}
        fill="transparent"
        stroke={color}
        strokeWidth={width}
        vectorEffect="non-scaling-stroke"
        style={{ cursor }}
      />
      {ordinal !== undefined ? (
        <text
          x={drawn.x}
          y={drawn.y - 3 / scale}
          fontSize={12 / scale}
          fontWeight={600}
          fill={color}
          pointerEvents="none"
        >
          {ordinal}
        </text>
      ) : null}
      {grips
        ? EDGES.map((edge) => {
            const [from, to] = EDGE_ENDS[edge];
            return (
              <line
                key={edge}
                data-handle={edge}
                x1={corners[from].x}
                y1={corners[from].y}
                x2={corners[to].x}
                y2={corners[to].y}
                stroke="transparent"
                strokeWidth={EDGE_GRAB_SCREEN_WIDTH}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                style={{ cursor: HANDLE_CURSORS[edge] }}
              />
            );
          })
        : null}
      {grips
        ? CORNERS.map((corner) => (
            <rect
              key={corner}
              data-handle={corner}
              x={corners[corner].x - grip / 2}
              y={corners[corner].y - grip / 2}
              width={grip}
              height={grip}
              fill={CANVAS_COLORS.handle}
              stroke={color}
              strokeWidth={width}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: HANDLE_CURSORS[corner] }}
            />
          ))
        : null}
    </>
  );
}

/** The boxes a proposal asks a person to confirm, ringed. */
export function ChecksLayer({
  image,
  checks,
  layers,
}: {
  image: ImageSize;
  checks: AnnotationInstance[];
  layers: ReadonlySet<LayerKey>;
}) {
  const { scale } = useViewport();
  if (!layers.has("checks") || checks.length === 0) return null;
  const gap = 3 / scale;
  return (
    <Layer image={image} pointerEvents="none">
      {checks.map(({ id, bbox }) => (
        <rect
          key={id}
          x={bbox.x - gap}
          y={bbox.y - gap}
          width={bbox.width + 2 * gap}
          height={bbox.height + 2 * gap}
          fill="none"
          stroke={CANVAS_COLORS.check}
          strokeWidth={LINE_WIDTH}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </Layer>
  );
}

type BoxGesture =
  | {
      kind: "move";
      pointerId: number;
      id: string;
      start: Point;
      box: ImageRectangle;
      /** The box was selected before this press, so a press without a drag turns it over. */
      wasSelected: boolean;
    }
  | {
      kind: "resize";
      pointerId: number;
      id: string;
      handle: Handle;
      start: Point;
      box: ImageRectangle;
    };

/**
 * The boxes of a draft. Press a box to select it and press it again to give
 * it the next class; drag it to move it, drag a handle to resize it. Press
 * empty image to add a box, or to clear the selection when one is selected.
 * Dragging empty image pans, as does anything while space is held, the
 * draft is being saved, the boxes are locked or they are hidden: boxes are
 * edited only where they are seen.
 */
export function EditableBoxLayer({
  image,
  classes,
  instances,
  layers,
  panning,
  activeClass,
  selectedId,
  onSelect,
  onClassChange,
  onInstancesChange,
}: {
  image: ImageSize;
  classes: readonly string[];
  instances: AnnotationInstance[];
  layers: ReadonlySet<LayerKey>;
  /** True while space is held, the draft is saving or the boxes are locked: the pointer only pans. */
  panning: boolean;
  activeClass: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Gives the selected box another class. */
  onClassChange: (name: string) => void;
  onInstancesChange: (instances: AnnotationInstance[]) => void;
}) {
  const viewport = useViewport();
  const [gesture, setGesture] = useState<BoxGesture | null>(null);
  const shown = layers.has("boxes");
  const editable = shown && !panning;

  /**
   * Places a square the size of the boxes already on the image, so added
   * boxes share one convention, and selects it to show its handles.
   */
  const addBoxAt = (center: Point) => {
    const box = boxAround(center, initialBoxSide(instances, image), image);
    if (!box) return;
    const instance = instanceFromBox(activeClass, box);
    onInstancesChange([...instances, instance]);
    onSelect(instance.id);
  };

  const pan = usePanGesture(viewport, (point) => {
    if (!editable) return;
    if (selectedId !== null) onSelect(null);
    else addBoxAt(point);
  });

  const onPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (!editable) {
      pan.onPointerDown(event);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const handleValue = target?.getAttribute("data-handle") ?? null;
    const handle = isHandle(handleValue) ? handleValue : null;
    const id =
      target?.closest("[data-instance-id]")?.getAttribute("data-instance-id") ??
      null;
    const instance = instances.find((item) => item.id === id);
    if (!instance) {
      pan.onPointerDown(event);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = viewport.toImagePoint(event);
    if (handle) {
      setGesture({
        kind: "resize",
        pointerId: event.pointerId,
        id: instance.id,
        handle,
        start,
        box: instance.bbox,
      });
      return;
    }
    onSelect(instance.id);
    setGesture({
      kind: "move",
      pointerId: event.pointerId,
      id: instance.id,
      start,
      box: instance.bbox,
      wasSelected: instance.id === selectedId,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!gesture) {
      pan.onPointerMove(event);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const point = viewport.toImagePoint(event);
    const delta = {
      x: point.x - gesture.start.x,
      y: point.y - gesture.start.y,
    };
    const box = instances.find((item) => item.id === gesture.id)?.bbox;
    if (!box) return;
    setGesture(
      gesture.kind === "move"
        ? { ...gesture, box: moveBox(box, delta, image) }
        : { ...gesture, box: resizeBox(box, gesture.handle, delta, image) },
    );
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!gesture) {
      pan.onPointerUp(event);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    setGesture(null);
    const instance = instances.find((item) => item.id === gesture.id);
    if (!instance) return;
    if (sameBox(instance.bbox, gesture.box)) {
      if (gesture.kind === "move" && gesture.wasSelected) {
        onClassChange(nextClass(classes, instance.class));
      }
      return;
    }
    onInstancesChange(
      instances.map((item) =>
        item.id === gesture.id ? { ...item, bbox: gesture.box } : item,
      ),
    );
  };

  const onPointerCancel = (event: React.PointerEvent) => {
    if (!gesture) pan.onPointerCancel(event);
    else if (gesture.pointerId === event.pointerId) setGesture(null);
  };

  const cursor = pan.dragging ? "grabbing" : editable ? "crosshair" : "grab";

  return (
    <Layer
      image={image}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <rect width={image.width} height={image.height} fill="transparent" />
      {shown
        ? instances.map((instance, index) => {
            const box =
              gesture?.id === instance.id ? gesture.box : instance.bbox;
            const selected = instance.id === selectedId;
            const color = classColor(classes, instance.class).hex;
            return (
              <g
                key={instance.id}
                data-instance-id={instance.id}
                opacity={
                  selectedId === null || selected ? 1 : UNSELECTED_OPACITY
                }
              >
                <Box
                  box={box}
                  color={color}
                  ordinal={layers.has("ids") ? index + 1 : undefined}
                  selected={selected}
                  grips={selected && editable}
                  cursor={editable ? "move" : undefined}
                />
              </g>
            );
          })
        : null}
    </Layer>
  );
}
