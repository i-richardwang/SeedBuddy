import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  BaselineDay,
  UnitBaseline,
} from "../../domain/experiments/read-model";
import { observation } from "../../domain/experiments/testing";
import { UnitBaselineValue } from "./UnitBaseline";
import { optionLabel } from "./UnitBaselineDialog";

const sown = observation(1);
const grown = observation(2, ["germinated"]);
const rooted = observation(3, ["rooted"], "rooting");
const observations = [sown, grown, rooted];

function baseline(overrides: Partial<UnitBaseline> = {}): UnitBaseline {
  return {
    observation: sown.id,
    count: 20,
    source: "review",
    gap: null,
    named: false,
    wanted: false,
    ...overrides,
  };
}

const shown = (value: UnitBaseline | null) =>
  renderToStaticMarkup(
    <UnitBaselineValue baseline={value} observations={observations} />,
  );

test("a baseline read on the first observation is its number alone", () => {
  expect(shown(baseline())).toContain("20");
  expect(shown(baseline())).not.toContain("Sep");
});

test("a number nobody has reviewed yet is shown provisional", () => {
  expect(shown(baseline())).not.toContain('data-type="tertiary"');
  expect(shown(baseline({ source: "detection" }))).toContain(
    'data-type="tertiary"',
  );
});

test("a baseline the unit names says which observation", () => {
  expect(shown(baseline({ observation: grown.id, named: true }))).toContain(
    "Sep 2, 2026",
  );
});

test("a baseline a rate waits on asks for attention, by name and with why", () => {
  const wanted = shown(
    baseline({ count: null, source: null, gap: "unclear", wanted: true }),
  );
  expect(wanted).toContain('data-type="warning"');
  expect(wanted).toContain("Not set");
  expect(wanted).toContain("Sep 1, 2026: unclear photo");
});

test("a baseline nothing waits on is only absent", () => {
  const absent = shown(
    baseline({ count: null, source: null, gap: "unread", wanted: false }),
  );
  expect(absent).not.toContain("warning");
  expect(absent).not.toContain("Not set");
  expect(shown(null)).toBe(absent);
});

test("the dialog offers each observation with what it would give", () => {
  const days = new Map<string, BaselineDay>([
    [
      sown.id,
      { observation: sown.id, count: null, source: null, gap: "unclear" },
    ],
    [
      grown.id,
      { observation: grown.id, count: 20, source: "review", gap: null },
    ],
  ]);
  expect(optionLabel(sown, sown, days)).toBe(
    "Sep 1, 2026 (first observation) · unclear photo",
  );
  expect(optionLabel(grown, sown, days)).toBe("Sep 2, 2026 · 20");
  // A day read for another model gives no baseline, whoever is asked.
  expect(optionLabel(rooted, sown, undefined)).toBe(
    "Sep 3, 2026 · another model",
  );
  expect(optionLabel(grown, sown, undefined)).toBe("Sep 2, 2026");
});
