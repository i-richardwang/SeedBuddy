import { z } from "zod";

import {
  type TrainingOverrides,
  type TrainingParameters,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";
import { parameterLabel } from "./labels";

interface ParameterGroup {
  key: string;
  title: () => string;
  parameters: (keyof TrainingParameters)[];
}

/** The recipe's parameters by what they govern, in the order a run is read. */
export const PARAMETER_GROUPS: ParameterGroup[] = [
  {
    key: "training",
    title: m.parameter_group_training,
    parameters: [
      "epochs",
      "patience",
      "batch",
      "imgsz",
      "optimizer",
      "lr0",
      "warmup_epochs",
      "nbs",
    ],
  },
  {
    key: "augmentation",
    title: m.parameter_group_augmentation,
    parameters: [
      "mosaic",
      "mixup",
      "copy_paste",
      "scale",
      "degrees",
      "flipud",
      "fliplr",
      "translate",
      "hsv_h",
      "hsv_s",
      "hsv_v",
    ],
  },
  {
    key: "validation",
    title: m.parameter_group_validation,
    parameters: ["max_det", "seed", "deterministic"],
  },
];

export interface ParameterField {
  key: keyof TrainingOverrides;
  label: () => string;
  min: number;
  max: number;
  step: number;
  advanced: boolean;
  /** What the value does that its label does not say. */
  help?: () => string;
}

/** The schema supplies validation bounds; only interaction steps are UI choices. */
const properties = z.toJSONSchema(trainingOverridesSchema).properties!;
const FIELD_OPTIONS = {
  epochs: { step: 1, advanced: false },
  imgsz: { step: 32, advanced: false },
  batch: { step: 1, advanced: false },
  patience: { step: 1, advanced: false, help: m.parameter_patience_help },
  lr0: { step: 0.00001, advanced: false },
  warmup_epochs: { step: 0.1, advanced: true },
  nbs: { step: 1, advanced: true, help: m.parameter_nbs_help },
} satisfies Record<
  keyof TrainingOverrides,
  Pick<ParameterField, "step" | "advanced" | "help">
>;
export const PARAMETER_FIELDS: ParameterField[] = (
  Object.keys(FIELD_OPTIONS) as Array<keyof TrainingOverrides>
).map((key) => {
  const property = properties[key]!;
  if (
    typeof property === "boolean" ||
    property.minimum === undefined ||
    property.maximum === undefined
  )
    throw new Error(`Training field ${key} requires numeric bounds`);
  return {
    key,
    label: () => parameterLabel(key),
    min: property.minimum,
    max: property.maximum,
    ...FIELD_OPTIONS[key],
  };
});
