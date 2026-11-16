import { errorMessage } from "../../ui/errors";

/** A photograph the store already holds, under the name it was uploaded with. */
export interface StoredPhoto {
  digest: string;
  filename: string;
  bytes: number;
}

/** A photograph on hand: on its way to the store, held by it, or turned back. */
export interface PhotoOnHand {
  id: number;
  filename: string;
  /** The file's size, or the stored size of a photograph that was never a file here. */
  bytes: number;
  state:
    | {
        status: "storing";
        /** The share of the file sent so far, 0 to 1. */
        progress: number;
      }
    | { status: "stored"; digest: string }
    | { status: "failed"; reason: string };
}

/** Stores one file and answers with its digest, reporting the share sent so far. */
export type StorePhoto = (
  file: File,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
) => Promise<{ digest: string }>;

/**
 * Photographs travelling at once. A second request keeps the server encoding
 * while the next photograph is still on the wire; more than that would queue
 * behind the same processor.
 */
const UPLOAD_LANES = 2;

export interface PhotosOnHand {
  subscribe: (listener: () => void) => () => void;
  /** The photographs in the order they came, the same array until one changes. */
  photos: () => readonly PhotoOnHand[];
  /** Sends files to the store, listing each as it travels. */
  upload: (files: readonly File[]) => void;
  /**
   * Lists photographs the store already holds, so taking the same ones twice
   * lists them once. A file that turns out to be one of them is still listed:
   * what to make of two alike is the form's to say.
   */
  take: (stored: readonly StoredPhoto[]) => void;
  /** Unlists a photograph, calling it back if it is still on the wire. */
  remove: (id: number) => void;
  /** Calls back what is on the wire and unlists it with what waits behind it. */
  stop: () => void;
}

/**
 * The photographs a form has on hand ahead of the record that will refer to
 * them: files it uploads, which go up as soon as they are given so that
 * using them afterwards is a decision rather than a wait, and photographs
 * the store already holds. `onStored` hears the digests of those the store
 * holds as they join: each upload once it is stored, and taken ones together.
 */
export function createPhotosOnHand({
  store,
  onStored,
}: {
  store: StorePhoto;
  onStored?: (digests: readonly string[]) => void;
}): PhotosOnHand {
  let photos: readonly PhotoOnHand[] = [];
  let nextId = 1;
  let queue: { id: number; file: File }[] = [];
  let lanes = 0;
  /** The photographs on the wire, each with the means to call it back. */
  const travelling = new Map<number, AbortController>();
  const listeners = new Set<() => void>();

  const set = (next: readonly PhotoOnHand[]) => {
    photos = next;
    for (const listener of listeners) listener();
  };
  /** A photograph no longer listed has no state to change. */
  const update = (id: number, state: PhotoOnHand["state"]) => {
    if (!photos.some((photo) => photo.id === id)) return;
    set(photos.map((photo) => (photo.id === id ? { ...photo, state } : photo)));
  };

  async function travel() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { id, file } = next;
      const upload = new AbortController();
      const { signal } = upload;
      travelling.set(id, upload);
      try {
        const { digest } = await store(
          file,
          (progress) => update(id, { status: "storing", progress }),
          signal,
        );
        if (signal.aborted) continue;
        update(id, { status: "stored", digest });
        onStored?.([digest]);
      } catch (cause) {
        if (signal.aborted) continue;
        update(id, { status: "failed", reason: errorMessage(cause) });
      } finally {
        travelling.delete(id);
      }
    }
    lanes -= 1;
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    photos: () => photos,
    upload: (files) => {
      const added = files.map((file) => ({ id: nextId++, file }));
      set([
        ...photos,
        ...added.map(({ id, file }) => ({
          id,
          filename: file.name,
          bytes: file.size,
          state: { status: "storing", progress: 0 } as const,
        })),
      ]);
      queue.push(...added);
      while (lanes < UPLOAD_LANES && queue.length > 0) {
        lanes += 1;
        void travel();
      }
    },
    take: (stored) => {
      const held = new Set(
        photos.flatMap(({ state }) =>
          state.status === "stored" ? [state.digest] : [],
        ),
      );
      const fresh = stored.filter(({ digest }) => {
        if (held.has(digest)) return false;
        held.add(digest);
        return true;
      });
      if (fresh.length === 0) return;
      set([
        ...photos,
        ...fresh.map(({ digest, filename, bytes }) => ({
          id: nextId++,
          filename,
          bytes,
          state: { status: "stored", digest } as const,
        })),
      ]);
      onStored?.(fresh.map(({ digest }) => digest));
    },
    remove: (id) => {
      queue = queue.filter((waiting) => waiting.id !== id);
      travelling.get(id)?.abort();
      set(photos.filter((photo) => photo.id !== id));
    },
    stop: () => {
      queue = [];
      for (const upload of travelling.values()) upload.abort();
      const settled = photos.filter(
        (photo) => photo.state.status !== "storing",
      );
      if (settled.length < photos.length) set(settled);
    },
  };
}

/** A photograph on hand that the store holds. */
export interface StoredOnHand extends StoredPhoto {
  id: number;
}

export function storedOnHand(photos: readonly PhotoOnHand[]): StoredOnHand[] {
  return photos.flatMap(({ id, filename, bytes, state }) =>
    state.status === "stored"
      ? [{ id, digest: state.digest, filename, bytes }]
      : [],
  );
}
