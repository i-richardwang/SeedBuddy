import { expect, test } from "bun:test";

import { m } from "../paraglide/messages";
import { formatDay } from "./Day";
import { errorMessage } from "./errors";

test("unrecognized business codes use their category, including Object property names", () => {
  for (const code of ["constructor", "toString", "__proto__", "new_code"]) {
    expect(
      errorMessage({
        kind: "business_failure",
        code,
        category: "conflict",
        details: {},
      }),
    ).toBe(m.error_conflict());
  }
});

test("known refusals have their specific message", () => {
  expect(
    errorMessage({
      kind: "business_failure",
      code: "model_name_taken",
      category: "conflict",
      details: {},
    }),
  ).toBe(m.error_model_id_taken());
});

test("an image refusal names each photograph and where the experiment holds it", () => {
  const message = errorMessage({
    kind: "business_failure",
    code: "experiment_observation_image_conflict",
    category: "conflict",
    details: {
      images: [
        {
          digest: "a".repeat(64),
          filename: "IMG_0412.jpg",
          unit: "A-1",
          observedOn: "2026-09-06",
        },
      ],
    },
  });
  expect(message).toBe(
    m.error_image_already_used({
      images: m.error_image_already_used_item({
        file: "IMG_0412.jpg",
        unit: "A-1",
        day: formatDay("2026-09-06"),
      }),
    }),
  );
  expect(message).toContain("IMG_0412.jpg");
});
