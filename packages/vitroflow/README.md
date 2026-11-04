# vitroflow

Prepare culture-dish photographs for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench.

A dish is often photographed several times in a row. `vitroflow photos sort` sorts a folder of photographs into dishes, puts the photograph whose seeds are sharpest first for each dish, and says whether the seeds in each photograph can be counted. `vitroflow photos review` then serves a page on which a person confirms, dish by dish, which photograph to use.

```bash
uvx vitroflow photos sort ~/plates -o ~/plates/plates.json
uvx vitroflow photos review ~/plates/plates.json
```

`python -m vitroflow` is the module entry point and accepts the same commands.

`sort` reads the folder's JPEG, PNG and TIFF files, prints JSON, writes the same JSON to the file given with `-o`, and leaves every photograph where it is:

```json
{
  "dishes": [
    {
      "shots": [
        {
          "path": "/home/lab/plates/plate-02.jpg",
          "sharpness": 0.0,
          "suitable": true,
          "reason": null,
          "alignment": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
        },
        {
          "path": "/home/lab/plates/plate-01.jpg",
          "sharpness": -0.4,
          "suitable": false,
          "reason": "seeds are out of focus",
          "alignment": [[0.998, 0.052, -41.3], [-0.052, 0.998, 96.8]]
        }
      ]
    }
  ],
  "skipped": [
    { "path": "/home/lab/plates/notes.png", "reason": "no dish found" }
  ]
}
```

Each entry of `dishes` is one dish, and `shots` lists its photographs sharpest first. The first shot is the suggestion.

- `sharpness` is the natural log of how sharply a photograph renders the seeds relative to the first one, so `-0.4` is about a third less fine detail. A dish photographed once has a `sharpness` of `null`.
- `suitable` says whether the seeds can be counted, and `reason` says why not.
- `alignment` is the camera motion that carries the photograph onto the first one of its dish, as the two rows of an affine matrix in pixels.

`skipped` lists files that could not be read or that show no dish.

## How photographs are matched

Photographs show the same dish when one movement of the camera carries the layout of the whole dish, seeds, substrate outline and lid labels alike, from one photograph onto the other. Agreement in one small region, such as a date label that every dish of a batch carries, is not enough. The decision depends on the share of features that agree and the area they cover, not on how many seeds a dish holds, and the handwriting on labels is never read.

## How focus is judged

Two photographs of one dish are compared at the same physical points within the central 60% of the dish's radius, where the seeds lie and the lid labels do not reach. At each point the finest detail is weighed against the seed's outline, which cancels exposure, so a photograph focused on the labels rather than the seeds ranks low.

## Whether a photograph can be counted

Each photograph is judged on its own, so the sharpest photograph of a dish can still be one that cannot be counted. The seeds lie on the filter paper, inside the rim, where the lid labels do not reach. They can be counted when their own mark is crisp against the paper. `suitable` is false when that mark has gone soft (`seeds are out of focus`), or when tiny gray droplets are spread across the paper and the seeds themselves are not a crisp colored mark (`paper covered by droplets`). A small seed that is still a separate mark can be counted, and so can a germinated seed.

## Confirming the suggestions

The first shot and its `suitable` are a suggestion, and the person who will count the dish has the last word. `review` prints the address of a page on the local computer. The page lists the dishes and shows every photograph of the one in view. Changing between the photographs of a dish keeps each seed in place, so focus can be compared at one spot.

For each dish, accept the suggestion, or bring up the photograph to use and mark its seeds as countable, not countable, or not sure. A decision moves on to the next dish that still has none. A note can be kept with the confirmation. Accept remaining suggestions confirms the suggestion for every dish that still has none, and leaves a correction that is already there as it is. Worth a look shows the dishes whose suggested photograph cannot be counted, or that have another photograph about as sharp.

The confirmation is stored in the same file, beside the dish's shots:

```json
{
  "shots": [...],
  "decision": {
    "chosen": "/home/lab/plates/plate-01.jpg",
    "suitable": true,
    "note": "thin, but each seed is separate"
  }
}
```

`decision.chosen` is the photograph to use. `decision.suitable` is `true` when its seeds can be counted, `false` when they cannot, and `null` when the person was not sure. Sorting into the same file again is refused once any confirmation is present.

## Publishing

The package version is in `packages/vitroflow/pyproject.toml`. From the repository root, build into an empty `dist/` and publish:

```bash
uv build --package vitroflow
uv publish
```

The publishing credential is described in the repository environment example. The release tag matches the package version.
