import { expect, test } from "bun:test";

import type { ImageRegion } from "../images/geometry";
import { collectRegions } from "./results";
import type { AnnotationDefinition } from "./schema";
import { owns, prepareProposal, regions, tiles } from "./tasks";

const definition: AnnotationDefinition = {
  input: null,
  scope: null,
  coverage: null,
  image: { digest: "a".repeat(64), width: 120, height: 80 },
  config: {
    area: "image",
    coreSize: 64,
    halo: 16,
    displayScale: 4,
    classes: ["ungerminated", "germinated"],
    rules: "Box seeds",
  },
};

test("regions preserve source coverage, clip halo and assign seam centers exactly once", () => {
  const tasks = regions(definition);
  expect(tasks).toHaveLength(4);
  expect(tasks[0]!.patch).toEqual({ x: 0, y: 0, width: 80, height: 80 });
  const box = { x: 60, y: 20, width: 8, height: 8 };
  expect(
    tasks.filter((task) => owns(task.core, box)).map((task) => task.id),
  ).toEqual(["tile-000-001"]);
  const prepared = prepareProposal(
    {
      instances: [
        { id: "seed", class: "ungerminated", box_2d: [250, 250, 500, 500] },
      ],
    },
    tasks[0]!,
    definition,
  );
  expect(prepared.content.document.instances[0]!.bbox).toEqual({
    x: 20,
    y: 20,
    width: 20,
    height: 20,
  });
});

test("internal clipping is rejected for owned objects; context and source boundaries remain legal", () => {
  const task = regions(definition)[0]!;
  const propose = (box_2d: number[]) => ({
    instances: [{ id: "seed", class: "ungerminated", box_2d }],
  });
  expect(() =>
    prepareProposal(propose([100, 400, 300, 1000]), task, definition),
  ).toThrow("internal patch boundary");
  expect(() =>
    prepareProposal(propose([100, 0, 300, 100]), task, definition),
  ).not.toThrow();
  expect(() =>
    prepareProposal(propose([100, 900, 300, 1000]), task, definition),
  ).not.toThrow();
  expect(() =>
    prepareProposal(propose([100, 400, 300, Infinity]), task, definition),
  ).toThrow();
});

/** The patch edges of a source box, as a region's proposal states them. */
function drawn(
  region: ImageRegion,
  id: string,
  x: number,
  width: number,
  state = "ungerminated",
) {
  const p = region.patch;
  const y = 20,
    height = 8;
  return {
    id,
    class: state,
    box_2d: [
      ((y - p.y) * 1000) / p.height,
      ((x - p.x) * 1000) / p.width,
      ((y + height - p.y) * 1000) / p.height,
      ((x + width - p.x) * 1000) / p.width,
    ],
    uncertain: false,
  };
}

test("neighbors that read one seam object yield one box, whichever side they place its center", () => {
  const [left, right] = regions(definition) as [ImageRegion, ImageRegion];
  const collect = (fromLeft: number[], fromRight: number[]) =>
    collectRegions(definition, [
      {
        taskId: "run/left",
        region: left,
        response: {
          instances: fromLeft.map((x, i) => drawn(left, `l${i}`, x, 14)),
        },
      },
      {
        taskId: "run/right",
        region: right,
        response: {
          instances: fromRight.map((x, i) => drawn(right, `r${i}`, x, 14)),
        },
      },
    ]).document.instances.map((item) => item.id);
  // Both centers on their own side: each region owns a copy.
  expect(collect([56], [59])).toEqual(["run/left/l0"]);
  // Both centers on the other side: neither region owns it.
  expect(collect([58], [55])).toEqual(["run/left/l0"]);
  // One owner and one halo reading agree.
  expect(collect([59], [59])).toEqual(["run/right/r0"]);
  // Touching neighbors and overlaps within one region stay apart.
  expect(collect([44, 52], [64])).toEqual([
    "run/left/l0",
    "run/left/l1",
    "run/right/r0",
  ]);
  // A halo reading its owner did not confirm is dropped.
  expect(collect([66], [])).toEqual([]);
});

test("neighbors that judge a seam object differently yield one box, as its owner judged it", () => {
  const [left, right] = regions(definition) as [ImageRegion, ImageRegion];
  const result = collectRegions(definition, [
    {
      taskId: "run/left",
      region: left,
      response: {
        instances: [drawn(left, "l", 59, 14, "ungerminated")],
      },
    },
    {
      taskId: "run/right",
      region: right,
      response: {
        instances: [drawn(right, "r", 59, 14, "germinated")],
      },
    },
  ]);
  expect(
    result.document.instances.map(({ id, class: state }) => [id, state]),
  ).toEqual([["run/right/r", "germinated"]]);
});

test("a redrawn region's reading of a retained neighbor's object keeps the retained box", () => {
  const retained = {
    id: "kept",
    class: "ungerminated",
    bbox: { x: 58, y: 20, width: 14, height: 8 },
  };
  const scoped: AnnotationDefinition = {
    ...definition,
    input: [retained],
    inputUncertainIds: [],
    scope: [{ x: 0, y: 0, width: 10, height: 10 }],
  };
  const [left] = regions(scoped) as [ImageRegion];
  const result = collectRegions(scoped, [
    {
      taskId: "run/left",
      region: left,
      response: { instances: [drawn(left, "s", 56, 14)] },
    },
  ]);
  expect(result.document.instances).toEqual([retained]);
});

test("decimal source-edge boxes preview and collect identically, with halo-only boxes excluded", () => {
  for (const width of [17, 544, 1536]) {
    const frame = {
      ...definition,
      image: { ...definition.image, width, height: 17 },
    };
    const region = regions(frame).at(-1)!;
    const { response, content: preview } = prepareProposal(
      {
        instances: [
          {
            id: "edge",
            class: "ungerminated",
            box_2d: [1.4, 801.4, 1000, 1000],
          },
        ],
      },
      region,
      frame,
    );
    expect(preview.document.instances).toHaveLength(1);
    const box = preview.document.instances[0]!.bbox;
    expect(box.x + box.width).toBe(width);
    expect(box.y + box.height).toBe(frame.image.height);
    const collected = collectRegions(frame, [
      { taskId: "run/edge", region, response },
    ]);
    expect(collected.document.instances[0]!.bbox).toEqual(box);
  }
  const region = regions(definition)[0]!;
  const { response, content: preview } = prepareProposal(
    {
      instances: [
        { id: "owned", class: "ungerminated", box_2d: [100, 200, 300, 400] },
        {
          id: "neighbor",
          class: "ungerminated",
          box_2d: [100, 900, 300, 1000],
        },
      ],
    },
    region,
    definition,
  );
  expect(preview.document.instances.map((item) => item.id)).toEqual(["owned"]);
  expect(
    collectRegions(definition, [
      { taskId: "run/region", region, response },
    ]).document.instances.map((item) => item.id),
  ).toEqual(["run/region/owned"]);
});

test("fractional boxes touching the source boundary remain valid through collection", () => {
  const frame = {
    ...definition,
    image: { ...definition.image, width: 17, height: 512 },
    config: { ...definition.config, coreSize: 512, halo: 0 },
  };
  const region = regions(frame)[0]!;
  const { response, content: preview } = prepareProposal(
    {
      instances: [
        { id: "s", class: "ungerminated", box_2d: [100, 1.4, 300, 1000] },
      ],
    },
    region,
    frame,
  );
  expect(preview.document.instances).toHaveLength(1);
  const result = collectRegions(frame, [
    { taskId: "run/region", region, response },
  ]);
  const box = result.document.instances[0]!.bbox;
  expect(box.x + box.width).toBe(17);
});

test("a scope selects the regions it touches, and the result keeps the input boxes of the others", () => {
  const kept = {
    id: "kept",
    class: "ungerminated",
    bbox: { x: 4, y: 4, width: 8, height: 8 },
  };
  const replaced = {
    id: "replaced",
    class: "ungerminated",
    bbox: { x: 100, y: 10, width: 8, height: 8 },
  };
  const scoped: AnnotationDefinition = {
    ...definition,
    input: [kept, replaced],
    scope: [{ x: 90, y: 0, width: 20, height: 20 }],
  };
  expect(tiles(scoped)).toHaveLength(4);
  const redrawn = regions(scoped);
  expect(redrawn.map((region) => region.id)).toEqual(["tile-000-001"]);
  const result = collectRegions(scoped, [
    {
      taskId: "run/tile-000-001",
      region: redrawn[0]!,
      response: {
        instances: [
          {
            id: "s1",
            class: "ungerminated",
            box_2d: [200, 400, 400, 600],
            uncertain: false,
          },
        ],
      },
    },
  ]);
  expect(result.document.instances.map((instance) => instance.id)).toEqual([
    "run/tile-000-001/s1",
    "kept",
  ]);
  expect(
    regions({ ...scoped, scope: [{ x: 0, y: 0, width: 120, height: 80 }] }),
  ).toHaveLength(4);
});

test("dish-filtered cores retain their input boxes and which await confirmation; included boxes are not clipped to the circle", () => {
  const outside = {
    id: "keep",
    class: "ungerminated",
    bbox: { x: 10, y: 10, width: 10, height: 10 },
  };
  const dish: AnnotationDefinition = {
    ...definition,
    image: { ...definition.image, width: 1000, height: 1000 },
    config: {
      ...definition.config,
      coreSize: 100,
      displayScale: 1,
      area: "dish",
    },
    coverage: {
      kind: "dish",
      circle: { x: 500, y: 500, radius: 350 },
      margin: 0.15,
    },
    input: [outside],
    inputUncertainIds: [outside.id],
  };
  const tasks = regions(dish).map((region) => ({
    taskId: region.id,
    region,
    response: { instances: [] },
  }));
  const result = collectRegions(dish, tasks);
  expect(result.document.instances).toEqual([outside]);
  expect(result.uncertainIds).toEqual([outside.id]);
  const boundary = regions(dish).find(
    (region) => region.id === "tile-002-002",
  )!;
  const content = prepareProposal(
    {
      instances: [
        {
          id: "outside-circle",
          class: "ungerminated",
          box_2d: [200, 200, 260, 260],
        },
      ],
    },
    boundary,
    dish,
  ).content;
  expect(content.document.instances).toHaveLength(1);
});
