import { describe, expect, test } from "bun:test";

import {
  createPhotosOnHand,
  type PhotoOnHand,
  type StorePhoto,
} from "./photos-on-hand";

/** A store whose uploads wait to be settled by the test, in the order they began. */
function heldStore() {
  const uploads: {
    file: File;
    signal: AbortSignal;
    onProgress: (ratio: number) => void;
    arrive: (digest: string) => void;
    fail: (reason: string) => void;
  }[] = [];
  const store: StorePhoto = (file, onProgress, signal) =>
    new Promise((resolve, reject) => {
      uploads.push({
        file,
        signal,
        onProgress,
        arrive: (digest) => resolve({ digest }),
        fail: (reason) => reject(new Error(reason)),
      });
    });
  return { store, uploads };
}

const file = (name: string) => new File([name], name);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const states = (photos: readonly PhotoOnHand[]) =>
  photos.map(({ filename, state }) => [filename, state.status]);

describe("photographs on hand", () => {
  test("files travel two at a time and are listed in the order they came", async () => {
    const { store, uploads } = heldStore();
    const stored: string[][] = [];
    const onHand = createPhotosOnHand({
      store,
      onStored: (digests) => stored.push([...digests]),
    });

    onHand.upload([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    expect(uploads.map(({ file }) => file.name)).toEqual(["a.jpg", "b.jpg"]);

    uploads[0]!.onProgress(0.5);
    expect(onHand.photos()[0]!.state).toEqual({
      status: "storing",
      progress: 0.5,
    });

    uploads[1]!.arrive("digest-b");
    await settled();
    expect(uploads.map(({ file }) => file.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
    uploads[0]!.arrive("digest-a");
    uploads[2]!.arrive("digest-c");
    await settled();

    expect(states(onHand.photos())).toEqual([
      ["a.jpg", "stored"],
      ["b.jpg", "stored"],
      ["c.jpg", "stored"],
    ]);
    expect(stored).toEqual([["digest-b"], ["digest-a"], ["digest-c"]]);
  });

  test("a file the store turns back fails alone, with the reason given", async () => {
    const { store, uploads } = heldStore();
    const stored: string[][] = [];
    const onHand = createPhotosOnHand({
      store,
      onStored: (digests) => stored.push([...digests]),
    });

    onHand.upload([file("refused.jpg"), file("kept.jpg")]);
    uploads[0]!.fail("The batch is gone");
    uploads[1]!.arrive("digest-kept");
    await settled();

    expect(onHand.photos().map(({ state }) => state)).toEqual([
      { status: "failed", reason: "The batch is gone" },
      { status: "stored", digest: "digest-kept" },
    ]);
    expect(stored).toEqual([["digest-kept"]]);
  });

  test("removing a photograph calls it back from the wire or the queue", async () => {
    const { store, uploads } = heldStore();
    const stored: string[][] = [];
    const onHand = createPhotosOnHand({
      store,
      onStored: (digests) => stored.push([...digests]),
    });

    onHand.upload([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    const [a, , c] = onHand.photos();
    onHand.remove(c!.id);
    onHand.remove(a!.id);
    expect(uploads[0]!.signal.aborted).toBe(true);

    // A store that had already answered is not listened to either.
    uploads[0]!.arrive("digest-a");
    uploads[1]!.arrive("digest-b");
    await settled();

    expect(uploads).toHaveLength(2);
    expect(states(onHand.photos())).toEqual([["b.jpg", "stored"]]);
    expect(stored).toEqual([["digest-b"]]);
  });

  test("stored photographs are taken once each", () => {
    const { store } = heldStore();
    const stored: string[][] = [];
    const onHand = createPhotosOnHand({
      store,
      onStored: (digests) => stored.push([...digests]),
    });
    const photo = (digest: string) => ({
      digest,
      filename: `${digest}.jpg`,
      bytes: 10,
    });

    onHand.take([photo("one"), photo("two"), photo("one")]);
    onHand.take([photo("two"), photo("three")]);
    const before = onHand.photos();
    onHand.take([photo("three")]);

    expect(onHand.photos()).toBe(before);
    expect(onHand.photos().map(({ filename }) => filename)).toEqual([
      "one.jpg",
      "two.jpg",
      "three.jpg",
    ]);
    expect(stored).toEqual([["one", "two"], ["three"]]);
  });

  test("stopping unlists what travels and what waits, and later files still go up", async () => {
    const { store, uploads } = heldStore();
    const onHand = createPhotosOnHand({ store });
    let changes = 0;
    const unsubscribe = onHand.subscribe(() => {
      changes += 1;
    });

    onHand.upload([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    onHand.stop();
    expect(uploads.map(({ signal }) => signal.aborted)).toEqual([true, true]);
    uploads[0]!.fail("aborted");
    uploads[1]!.arrive("digest-b");
    await settled();
    expect(uploads).toHaveLength(2);
    expect(onHand.photos()).toEqual([]);
    expect(changes).toBe(2);

    onHand.upload([file("d.jpg")]);
    uploads[2]!.arrive("digest-d");
    await settled();
    expect(onHand.photos().at(-1)!.state).toEqual({
      status: "stored",
      digest: "digest-d",
    });
    unsubscribe();
  });
});
