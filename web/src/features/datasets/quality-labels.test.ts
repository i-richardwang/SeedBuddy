import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { m } from "../../paraglide/messages";
import { QualityAlert, QualityTags } from "../../ui/detection-quality";
import { qualityWarningLabels } from "./labels";

test("unrecognized warnings render as the generic label, not inherited object properties", () => {
  for (const Component of [QualityAlert, QualityTags]) {
    const markup = renderToStaticMarkup(
      createElement(Component, {
        labels: qualityWarningLabels({
          status: "review_required",
          warnings: ["constructor", "new_warning"],
        }),
      }),
    );
    expect(markup).not.toContain("constructor");
    expect(markup).not.toContain("new warning");
    expect(markup).toContain(m.quality_unknown_warning());
  }
});

test("known quality warnings use their localized labels", () => {
  const markup = renderToStaticMarkup(
    createElement(QualityAlert, {
      labels: qualityWarningLabels({
        status: "review_required",
        warnings: ["low_focus"],
      }),
    }),
  );
  expect(markup).toContain(m.quality_low_focus());
});
