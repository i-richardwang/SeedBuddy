import {
  blobEntryName,
  manifestEntryName,
} from "../../domain/datasets/archive-format";
import { encodeDatasetManifest } from "../../domain/datasets/manifest";
import { storedZip } from "../../lib/archive/zip";
import { imageBlobKey } from "../images/public";
import { requireBlob } from "../infra/blobs/store";
import { readDataset } from "./datasets";
import { datasetManifest } from "./transfer";

/**
 * The dataset as one archive: its manifest, then each image it names, read
 * from the store as the archive streams so that the response holds one
 * image at a time.
 */
export async function datasetArchive(
  datasetId: string,
): Promise<{ name: string; archive: ReadableStream<Uint8Array> } | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const manifest = await datasetManifest(dataset);
  const manifestBytes = encodeDatasetManifest(manifest);
  const archive = storedZip(
    (async function* () {
      yield {
        name: manifestEntryName(manifest.dataset),
        bytes: manifestBytes,
      };
      for (const image of manifest.images) {
        yield {
          name: blobEntryName(image.digest),
          bytes: await requireBlob(imageBlobKey(image.digest)),
        };
      }
    })(),
  );
  return { name: manifest.dataset, archive };
}
