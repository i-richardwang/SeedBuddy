import { describe, expect, test } from "bun:test";

import type { Dataset } from "../../domain/datasets/schema";
import type { CultureEventsResult } from "../../domain/experiments/culture-events";
import type {
  ExperimentSheetDetail,
  ExperimentSummary,
  SheetCell,
  Unit,
  UnitRowOverview,
} from "../../domain/experiments/read-model";
import type {
  Experiment,
  ExperimentObservation,
  ManualReading,
} from "../../domain/experiments/schema";
import { rowCell } from "../../domain/experiments/testing";
import { storeAnnotation } from "../annotations/documents";
import { createModel } from "../models/public";
import { observeImagesForModel } from "../testing/experiments";
import { imageDigest, storeTexts } from "../testing/images";
import { baselineVersion } from "../testing/models";
import { type AgentCallResult, executeAgentOperation } from "./execution";
import { agentOperations, describeAgentOperations } from "./operations";
import { failure } from "./testing";

function output(result: AgentCallResult): unknown {
  if (!result.ok) throw new Error(`Operation failed: ${result.message}`);
  return result.output;
}

async function readSheet(
  experiment: string,
  page: Record<string, unknown> = {},
): Promise<ExperimentSheetDetail> {
  return output(
    await executeAgentOperation("get-experiment", { experiment, ...page }),
  ) as ExperimentSheetDetail;
}

function unitsOn(sheet: ExperimentSheetDetail): Unit[] {
  return sheet.units.rows.map((row) => row.unit);
}

function cellsOf(sheet: ExperimentSheetDetail): SheetCell[] {
  return sheet.units.rows.flatMap((row) => row.cells);
}

function cellOf(
  sheet: ExperimentSheetDetail,
  unit: string,
  observation: string,
): SheetCell {
  return rowCell(sheet.units.rows, unit, observation);
}

describe("agent operations", () => {
  test("every operation describes itself with schemas and behavior hints", () => {
    const described = describeAgentOperations();
    expect(described.map(({ name }) => name)).toEqual([
      ...agentOperations.keys(),
    ]);
    for (const { description, kind, input, output } of described) {
      expect(description.length).toBeGreaterThan(0);
      expect(input).toMatchObject({ type: "object" });
      expect(output).toBeDefined();
      expect(["query", "command"]).toContain(kind);
    }
  });

  test("behavior hints classify every operation explicitly", () => {
    const readOnly = new Set([
      "list-experiments",
      "get-experiment",
      "get-experiment-summary",
      "get-unit",
      "list-datasets",
      "get-dataset",
      "list-models",
      "list-model-versions",
      "list-training-workers",
      "list-training-runs",
      "get-training-run",
      "get-inference-task",
    ]);
    const additive = new Set([
      "create-experiment",
      "create-treatment",
      "add-replicates",
      "create-observation",
      "assign-images-to-observation",
      "record-culture-events",
      "create-dataset",
      "add-images-to-dataset",
      "create-model",
      "prepare-model-upload",
      "register-model-upload",
      "start-training-run",
    ]);
    const destructive = new Set([
      "update-experiment",
      "delete-experiment",
      "update-treatment",
      "delete-treatment",
      "update-unit",
      "move-units",
      "delete-unit",
      "update-observation",
      "delete-observation",
      "unassign-observation-image",
      "retry-observation-image-analysis",
      "mark-image-unclear",
      "clear-image-unclear",
      "enter-manual-readings",
      "delete-culture-event",
      "update-dataset",
      "remove-images-from-dataset",
      "update-model-annotation",
      "delete-model",
      "use-model-version",
      "control-training-run",
      "retry-inference-task",
    ]);
    expect([...readOnly, ...additive, ...destructive].sort()).toEqual(
      [...agentOperations.keys()].sort(),
    );

    for (const [name, entry] of agentOperations) {
      if (readOnly.has(name)) {
        expect(entry).toMatchObject({ kind: "query", destructive: false });
      } else if (additive.has(name)) {
        expect(entry).toMatchObject({ kind: "command", destructive: false });
      } else {
        expect(destructive.has(name)).toBe(true);
        expect(entry).toMatchObject({ kind: "command", destructive: true });
      }
    }
  });

  test("operations drive a data-entry workflow end to end", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Agent entry",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;

    const duplicate = await executeAgentOperation("create-treatment", {
      experiment: experiment.id,
      name: "T1",
      replicates: 1,
    });
    expect(failure(duplicate).code).toBe("conflict");

    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-15",
        modelId: version.modelId,
      }),
    ) as ExperimentObservation;
    expect(observation.observedOn).toBe("2026-08-15");

    const sheet = await readSheet(experiment.id);
    expect(sheet.treatments.map(({ name }) => name)).toContain("T1");
    expect(sheet.units.rows).toHaveLength(2);
    // A cell for every unit on the one day, with nothing in it yet.
    expect(cellsOf(sheet)).toHaveLength(2);
    expect(
      cellsOf(sheet).every((cell) => cell.observation === observation.id),
    ).toBe(true);
    expect(cellsOf(sheet)[0]).toMatchObject({
      reading: null,
      exclusion: null,
      image: null,
      manual: null,
    });

    const summaries = output(
      await executeAgentOperation("list-experiments", {}),
    ) as { experiment: { id: string } }[];
    expect(summaries.map((summary) => summary.experiment.id)).toContain(
      experiment.id,
    );
  });

  test("culture events are recorded on units together, and the sheet says what they take out", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Culture events",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 3 }],
      }),
    ) as Experiment;
    const first = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-10",
        modelId: version.modelId,
      }),
    ) as ExperimentObservation;
    const second = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-20",
        modelId: version.modelId,
      }),
    ) as ExperimentObservation;
    const [lost, kept, spare] = unitsOn(await readSheet(experiment.id));

    const recorded = output(
      await executeAgentOperation("record-culture-events", {
        experiment: experiment.id,
        units: [lost!.id, spare!.id],
        observation: first.id,
        type: "contaminated",
      }),
    ) as CultureEventsResult;
    expect(recorded.passedOver).toEqual([]);
    const contaminated = recorded.recorded.map(({ event }) => event);
    expect(contaminated.map(({ type }) => type)).toEqual([
      "contaminated",
      "contaminated",
    ]);
    const harvest = output(
      await executeAgentOperation("record-culture-events", {
        experiment: experiment.id,
        units: [kept!.id],
        observation: first.id,
        type: "harvested",
      }),
    ) as CultureEventsResult;
    const harvested = harvest.recorded[0]!.event;
    expect(harvested.observation).toBe(first.id);

    const sheet = await readSheet(experiment.id);
    expect(cellOf(sheet, lost!.id, first.id).exclusion).toEqual({
      reason: "event",
      event: contaminated[0],
    });
    expect(cellOf(sheet, lost!.id, second.id).exclusion).toMatchObject({
      reason: "event",
    });
    // Harvesting keeps the day it was recorded on and takes the unit off the bench after.
    expect(cellOf(sheet, kept!.id, first.id).exclusion).toBeNull();
    expect(cellOf(sheet, kept!.id, second.id).exclusion).toEqual({
      reason: "event",
      event: harvested,
    });

    output(
      await executeAgentOperation("delete-culture-event", {
        experiment: experiment.id,
        event: contaminated[1]!.id,
      }),
    );
    expect(
      cellOf(await readSheet(experiment.id), spare!.id, first.id).exclusion,
    ).toBeNull();
    // A unit with a record stays, and so does its observation.
    expect(
      failure(
        await executeAgentOperation("delete-observation", {
          experiment: experiment.id,
          observation: first.id,
        }),
      ).code,
    ).toBe("conflict");

    // A treatment's units take the event, those that cannot are passed over,
    // and a selection made over another number of units is refused.
    const treatment = (await readSheet(experiment.id)).treatments[0]!;
    const select = (expected: number) =>
      executeAgentOperation("record-culture-events", {
        experiment: experiment.id,
        units: { treatment: treatment.id, expected },
        observation: first.id,
        type: "contaminated",
      });
    expect(failure(await select(2)).code).toBe("conflict");
    const every = output(await select(3)) as CultureEventsResult;
    expect(every.passedOver.map(({ code, reason }) => [code, reason])).toEqual([
      [lost!.code, "recorded"],
    ]);
  });

  test("counts taken by hand enter a day, outrank its photographs, and withdraw", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Counted at the bench",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;
    const [photo] = await storeTexts(["agent-counted"]);
    const units = unitsOn(await readSheet(experiment.id));
    const [photographed, counted] = units;
    // The day is created with the one photograph taken on it.
    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-15",
        modelId: version.modelId,
        countedClasses: ["germinated"],
        images: [
          { unit: photographed!.id, digest: photo, filename: "dish-1.jpg" },
        ],
      }),
    ) as ExperimentObservation;
    expect(observation.hasRecords).toBe(true);
    let sheet = await readSheet(experiment.id);
    expect(cellOf(sheet, photographed!.id, observation.id).image).toMatchObject(
      { digest: photo, filename: "dish-1.jpg" },
    );
    expect(cellOf(sheet, counted!.id, observation.id)).toMatchObject({
      reading: null,
      image: null,
      manual: null,
    });

    const entered = output(
      await executeAgentOperation("enter-manual-readings", {
        experiment: experiment.id,
        observation: observation.id,
        readings: [
          { unit: photographed!.id, tally: { germinated: 9 } },
          { unit: counted!.id, tally: { germinated: 7 } },
        ],
      }),
    ) as ManualReading[];
    // The day's counts come back as listed, in no particular order of units.
    const byUnit = ({ unit }: { unit: string }, other: { unit: string }) =>
      unit.localeCompare(other.unit);
    expect(
      entered.map(({ unit, tally }) => ({ unit, tally })).sort(byUnit),
    ).toEqual(
      [
        { unit: photographed!.id, tally: { germinated: 9 } },
        { unit: counted!.id, tally: { germinated: 7 } },
      ].sort(byUnit),
    );

    sheet = await readSheet(experiment.id);
    expect(cellOf(sheet, photographed!.id, observation.id)).toMatchObject({
      reading: { count: 9, source: "manual" },
      image: { digest: photo },
      manual: { tally: { germinated: 9 } },
    });
    expect(cellOf(sheet, counted!.id, observation.id)).toMatchObject({
      reading: { count: 7, source: "manual" },
      exclusion: null,
      image: null,
      manual: { tally: { germinated: 7 } },
    });

    const row = output(
      await executeAgentOperation("get-unit", {
        experiment: experiment.id,
        unit: counted!.id,
      }),
    ) as UnitRowOverview;
    expect(row.unit.id).toBe(counted!.id);
    expect(row.treatment.name).toBe("T1");
    expect(row.cells).toHaveLength(1);
    expect(row.cells[0]!.reading).toEqual({ count: 7, source: "manual" });

    // A class the day counts must be given; a class the model lacks is refused.
    expect(
      failure(
        await executeAgentOperation("enter-manual-readings", {
          experiment: experiment.id,
          observation: observation.id,
          readings: [{ unit: counted!.id, tally: { shoots: 1 } }],
        }),
      ).code,
    ).toBe("invalid_request");

    output(
      await executeAgentOperation("enter-manual-readings", {
        experiment: experiment.id,
        observation: observation.id,
        readings: [{ unit: counted!.id, tally: null }],
      }),
    );
    expect(
      cellOf(await readSheet(experiment.id), counted!.id, observation.id),
    ).toMatchObject({ reading: null, manual: null });
    expect(
      failure(
        await executeAgentOperation("get-unit", {
          experiment: experiment.id,
          unit: crypto.randomUUID(),
        }),
      ).code,
    ).toBe("not_found");
  });

  test("units move to another treatment together, keeping their codes", async () => {
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Moved units",
        inoculatedOn: "2026-08-01",
        treatments: [
          { name: "A", replicates: 3 },
          { name: "B", replicates: 1 },
        ],
      }),
    ) as Experiment;
    const sheet = await readSheet(experiment.id);
    const b = sheet.treatments.find(({ name }) => name === "B")!;
    const fromA = unitsOn(sheet).filter(({ treatment }) => treatment !== b.id);
    const moved = output(
      await executeAgentOperation("move-units", {
        experiment: experiment.id,
        units: fromA.slice(0, 2).map(({ id }) => id),
        treatment: b.id,
      }),
    ) as Unit[];
    expect(moved.map(({ treatment }) => treatment)).toEqual([b.id, b.id]);
    expect(moved.map(({ code }) => code)).toEqual(
      fromA.slice(0, 2).map(({ code }) => code),
    );
  });

  test("the sheet is read a page of units at a time, and the summary on its own", async () => {
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Paged sheet",
        inoculatedOn: "2026-08-01",
        treatments: [
          { name: "A", replicates: 3 },
          { name: "B", replicates: 2 },
        ],
      }),
    ) as Experiment;
    const b = (await readSheet(experiment.id)).treatments.find(
      ({ name }) => name === "B",
    )!;
    const narrowed = await readSheet(experiment.id, {
      treatment: b.id,
      page: 2,
      pageSize: 1,
    });
    expect(narrowed.units).toMatchObject({
      treatment: b.id,
      total: 2,
      page: 2,
      pageSize: 1,
      pages: 2,
    });
    expect(unitsOn(narrowed).map(({ code }) => code)).toEqual(["B-2"]);
    // A page past the last holds no units, and says how many pages there are.
    const past = await readSheet(experiment.id, { page: 4, pageSize: 2 });
    expect(past.units).toMatchObject({ page: 4, pages: 3, rows: [] });
    expect(
      failure(
        await executeAgentOperation("get-experiment", {
          experiment: experiment.id,
          treatment: crypto.randomUUID(),
        }),
      ).code,
    ).toBe("not_found");
    expect(
      failure(
        await executeAgentOperation("get-experiment", {
          experiment: experiment.id,
          pageSize: 201,
        }),
      ).code,
    ).toBe("invalid_request");

    const summary = output(
      await executeAgentOperation("get-experiment-summary", {
        experiment: experiment.id,
      }),
    ) as ExperimentSummary;
    expect(summary).toEqual({ baseline: null, cells: [] });
  });

  test("a photograph is marked unclear by digest, or as it is assigned", async () => {
    const version = await baselineVersion();
    const experiment = output(
      await executeAgentOperation("create-experiment", {
        name: "Agent unclear",
        inoculatedOn: "2026-08-01",
        treatments: [{ name: "T1", replicates: 2 }],
      }),
    ) as Experiment;
    const observation = output(
      await executeAgentOperation("create-observation", {
        experiment: experiment.id,
        observedOn: "2026-08-10",
        modelId: version.modelId,
      }),
    ) as ExperimentObservation;
    const units = unitsOn(await readSheet(experiment.id));
    const [fogged, blurred] = await storeTexts(["agent-fogged", "agent-blur"]);
    output(
      await executeAgentOperation("assign-images-to-observation", {
        experiment: experiment.id,
        observation: observation.id,
        images: [
          {
            unit: units[0]!.id,
            digest: fogged,
            filename: "fogged.jpg",
            unclear: true,
          },
          { unit: units[1]!.id, digest: blurred, filename: "blurred.jpg" },
        ],
      }),
    );
    const cells = async () =>
      new Map(
        cellsOf(await readSheet(experiment.id)).flatMap((cell) =>
          cell.image ? [[cell.image.digest, cell.image.unclear] as const] : [],
        ),
      );
    expect((await cells()).get(fogged!)).toBe(true);
    expect((await cells()).get(blurred!)).toBe(false);
    // The experiment does not count unclear photographs unless it says so.
    expect(experiment.countsUnclear).toBe(false);

    // Marking twice is harmless: the second call finds the mark there.
    for (const marked of [true, false]) {
      expect(
        output(
          await executeAgentOperation("mark-image-unclear", {
            digest: blurred,
          }),
        ),
      ).toEqual({ digest: blurred, marked });
    }
    expect((await cells()).get(blurred!)).toBe(true);

    expect(
      output(
        await executeAgentOperation("clear-image-unclear", { digest: fogged }),
      ),
    ).toEqual({ digest: fogged, cleared: true });
    expect(
      output(
        await executeAgentOperation("clear-image-unclear", { digest: fogged }),
      ),
    ).toEqual({ digest: fogged, cleared: false });
    expect((await cells()).get(fogged!)).toBe(false);

    expect(
      failure(
        await executeAgentOperation("mark-image-unclear", {
          digest: "f".repeat(64),
        }),
      ).code,
    ).toBe("not_found");
    expect(
      failure(
        await executeAgentOperation("mark-image-unclear", {
          digest: "not-a-digest",
        }),
      ).code,
    ).toBe("invalid_request");
  });

  test("experiment images join and leave a dataset, keeping their reviews", async () => {
    const model = await createModel({
      id: "agent-dataset-task",
      name: "Agent dataset task",
      classes: ["shoot"],
    });
    const { images } = await observeImagesForModel(
      "Agent dataset images",
      ["agent-a", "agent-b", "agent-c"],
      model.id,
    );
    await storeAnnotation(
      { digest: await imageDigest("agent-b"), modelId: model.id },
      [],
      null,
    );

    const train = output(
      await executeAgentOperation("create-dataset", {
        name: "agent-train",
        modelId: model.id,
      }),
    ) as Dataset;
    expect(train).toEqual({
      id: expect.any(String),
      name: "agent-train",
      modelId: model.id,
    });
    expect(
      output(
        await executeAgentOperation("add-images-to-dataset", {
          dataset: train.id,
          images: images.slice(0, 2),
        }),
      ),
    ).toEqual({
      dataset: train,
      added: 2,
      existing: 0,
    });
    expect(
      output(
        await executeAgentOperation("add-images-to-dataset", {
          dataset: train.id,
          images,
        }),
      ),
    ).toMatchObject({ added: 1, existing: 2 });

    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toEqual([{ dataset: train, imageCount: 3, reviewedCount: 1 }]);

    const [a, b, c] = await Promise.all(
      ["agent-a", "agent-b", "agent-c"].map(imageDigest),
    );
    const contents = output(
      await executeAgentOperation("get-dataset", { dataset: train.id }),
    ) as { images: { digest: string; reviewed: boolean }[] };
    expect(
      contents.images
        .map(({ digest, reviewed }) => ({ digest, reviewed }))
        .sort((x, y) => x.digest.localeCompare(y.digest)),
    ).toEqual(
      [
        { digest: a, reviewed: false },
        { digest: b, reviewed: true },
        { digest: c, reviewed: false },
      ].sort((x, y) => x.digest.localeCompare(y.digest)),
    );

    expect(
      output(
        await executeAgentOperation("remove-images-from-dataset", {
          dataset: train.id,
          digests: [b, b, "0".repeat(64)],
        }),
      ),
    ).toEqual({
      dataset: train,
      removed: 1,
      absent: 1,
    });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toMatchObject([{ imageCount: 2, reviewedCount: 0 }]);
    await executeAgentOperation("add-images-to-dataset", {
      dataset: train.id,
      images,
    });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toMatchObject([{ imageCount: 3, reviewedCount: 1 }]);

    expect(
      output(
        await executeAgentOperation("update-dataset", {
          dataset: train.id,
          name: "agent-trained",
        }),
      ),
    ).toEqual({ ...train, name: "agent-trained" });
    expect(
      output(
        await executeAgentOperation("list-datasets", { modelId: model.id }),
      ),
    ).toEqual([
      {
        dataset: { ...train, name: "agent-trained" },
        imageCount: 3,
        reviewedCount: 1,
      },
    ]);
    const taken = await executeAgentOperation("create-dataset", {
      name: "Agent-Trained",
      modelId: model.id,
    });
    expect(failure(taken).code).toBe("conflict");
    const spare = output(
      await executeAgentOperation("create-dataset", {
        name: "agent-spare",
        modelId: model.id,
      }),
    ) as Dataset;
    const renamedOnto = await executeAgentOperation("update-dataset", {
      dataset: spare.id,
      name: "AGENT-TRAINED",
    });
    expect(failure(renamedOnto).code).toBe("conflict");

    const none = crypto.randomUUID();
    for (const missing of [
      await executeAgentOperation("get-dataset", { dataset: none }),
      await executeAgentOperation("remove-images-from-dataset", {
        dataset: none,
        digests: [a],
      }),
      await executeAgentOperation("add-images-to-dataset", {
        dataset: none,
        images,
      }),
    ]) {
      expect(failure(missing).code).toBe("not_found");
    }

    const version = await baselineVersion();
    const mismatch = await executeAgentOperation("add-images-to-dataset", {
      dataset: train.id,
      images: (
        await observeImagesForModel(
          "Agent dataset other model",
          ["agent-d"],
          version.modelId,
        )
      ).images,
    });
    expect(failure(mismatch).code).toBe("invalid_request");
  });
});
