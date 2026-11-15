import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { contentDigest } from "../infra/digest";
import { readWorkerPackage } from "./package";

test("a workbench ships the one seedctl wheel its package folder holds", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "worker-package-"));
  expect(await readWorkerPackage(path.join(folder, "absent"))).toBeNull();
  await writeFile(path.join(folder, "notes.txt"), "not a wheel");
  expect(await readWorkerPackage(folder)).toBeNull();

  const content = new TextEncoder().encode("wheel bytes");
  const filename = "seedctl-0.1.0-py3-none-any.whl";
  await writeFile(path.join(folder, filename), content);
  expect(await readWorkerPackage(folder)).toEqual({
    filename,
    digest: contentDigest(content),
    content: new Uint8Array(content),
  });

  await writeFile(path.join(folder, "seedctl-0.2.0-py3-none-any.whl"), content);
  await expect(readWorkerPackage(folder)).rejects.toThrow(/ships one/);
});
