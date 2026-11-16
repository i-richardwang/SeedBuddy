import { imageRefSchema } from "../../domain/images/schema";
import { parseHttpJson } from "../../lib/http/json";
import { m } from "../../paraglide/messages";
import type { StorePhoto } from "./photos-on-hand";
import { reducedForUpload } from "./reduce";

/** Sends one source image to the store, which answers with its digest. */
function send(
  source: Blob,
  /** The share of the source sent so far, 0 to 1. */
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<{ digest: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.open("POST", "/api/images");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      try {
        resolve(
          parseHttpJson(request.responseText, request.status, imageRefSchema),
        );
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error(m.upload_not_completed()));
    };
    request.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error(m.upload_cancelled()));
    };
    request.send(source);
  });
}

/**
 * Stores a photograph as the workbench takes it: one larger than it keeps is
 * reduced first, so what is sent, and what the progress measures, is the
 * reduced photograph.
 */
export const storePhoto: StorePhoto = async (file, onProgress, signal) => {
  const source = await reducedForUpload(file);
  signal.throwIfAborted();
  return send(source, onProgress, signal);
};
