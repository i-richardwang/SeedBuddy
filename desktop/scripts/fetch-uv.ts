/**
 * Fetches the `uv` the app carries to install the Worker runtime with: one
 * pinned release, checked against the digest recorded here.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";

const VERSION = "0.11.28";
const ARCHIVE = "uv-aarch64-apple-darwin";
const SHA256 =
  "33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232";

const target = "resources/uv";
const stamp = `${target}.version`;
const stamped = await Bun.file(stamp)
  .text()
  .catch(() => "");
if (stamped !== VERSION || !(await Bun.file(target).exists())) {
  const response = await fetch(
    `https://github.com/astral-sh/uv/releases/download/${VERSION}/${ARCHIVE}.tar.gz`,
  );
  if (!response.ok) throw new Error(`uv ${VERSION}: HTTP ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== SHA256)
    throw new Error(`uv ${VERSION}: digest ${digest} is not the pinned one`);

  await mkdir("resources", { recursive: true });
  const packed = `${target}.tar.gz`;
  await writeFile(packed, archive);
  const member = `${ARCHIVE}/uv`;
  await Bun.$`tar -xzf ${packed} -C resources ${member}`;
  await rename(`resources/${member}`, target);
  await rm(`resources/${ARCHIVE}`, { recursive: true });
  await rm(packed);
  await chmod(target, 0o755);
  await writeFile(stamp, VERSION);
}
