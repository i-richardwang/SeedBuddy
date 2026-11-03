import { imageRefSchema } from "../../domain/images/schema";
import { parseHttpJson } from "../../lib/http/json";
import { m } from "../../paraglide/messages";

export function storeImage(
  file: File,
  /** The share of the file sent so far, 0 to 1. */
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
      reject(new Error(m.upload_failed()));
    };
    request.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error(m.upload_cancelled()));
    };
    request.send(file);
  });
}
