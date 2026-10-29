import test from "node:test";
import assert from "node:assert/strict";
import {
  RecordingPlayer,
  voiceMode,
  selectNaturalVoice,
  recordingUrl,
  recordingUrls,
  cacheRecording,
  cacheRecordings,
} from "../src/recordedAudio.ts";
import { RequestCancelledError } from "../src/network.ts";

// Node has no browser CacheStorage property; restore its absence after each test.
function mockCaches(t: import("node:test").TestContext, value: CacheStorage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { value, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else Reflect.deleteProperty(globalThis, "caches");
  });
}

class FakeAudio {
  src = "";
  currentSrc = "";
  preload = "";
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = 0;
  played: string[] = [];
  playResult = Promise.resolve();
  play() {
    this.played.push(this.src);
    return this.playResult;
  }
  pause() {
    this.paused++;
  }
  load() {}
  removeAttribute() {
    this.src = "";
  }
}
function observer() {
  const events: string[] = [];
  return {
    events,
    callbacks: {
      start: () => events.push("start"),
      end: () => events.push("end"),
      error: (value: string) => events.push(value),
    },
  };
}

test("legacy device voices migrate to random naturally; fixed modes remain fixed", () => {
  assert.equal(voiceMode("com.apple.Samantha"), "random");
  assert.equal(voiceMode("natural:female"), "female");
  assert.equal(voiceMode("natural:male"), "male");
  assert.equal(
    selectNaturalVoice("random", () => 0.49),
    "female",
  );
  assert.equal(
    selectNaturalVoice("random", () => 0.5),
    "male",
  );
  assert.equal(
    selectNaturalVoice("male", () => 0),
    "male",
  );
});

test("recordings cover text variants in whitespace, deduplicate downloads, and never substitute a different phrase", () => {
  const url = recordingUrl("you lost me", "female");
  assert.match(url!, /^\/audio\/kokoro-v1\/female\/[a-f0-9]+\.mp3$/);
  assert.equal(recordingUrl("  you   lost me  ", "female"), url);
  assert.equal(recordingUrls(["you lost me", "you lost me"]).length, 2);
  assert.equal(
    recordingUrl("a private entry that has no recording", "male"),
    undefined,
  );
});

test("play is called in the original gesture; a replaced clip cannot finish or reject the current one", async () => {
  const audio = new FakeAudio();
  let rejectFirst!: (reason: Error) => void;
  audio.playResult = new Promise((_, reject) => {
    rejectFirst = reject;
  });
  const player = new RecordingPlayer(audio);
  const first = observer(),
    second = observer();
  player.play("/first.mp3", first.callbacks);
  assert.deepEqual(audio.played, ["/first.mp3"]);
  const staleEnd = audio.onended!;
  audio.playResult = Promise.resolve();
  player.play("/second.mp3", second.callbacks);
  audio.currentSrc = "/second.mp3";
  audio.onplaying!();
  staleEnd();
  rejectFirst(new Error("aborted old playback"));
  await Promise.resolve();
  assert.deepEqual(first.events, []);
  assert.deepEqual(second.events, ["start"]);
  audio.onended!();
  assert.deepEqual(second.events, ["start", "end"]);
  player.stop();
});

test("browser autoplay rejection is visible and never silently uses the system voice", async () => {
  const audio = new FakeAudio();
  audio.playResult = Promise.reject(
    new DOMException("blocked", "NotAllowedError"),
  );
  const player = new RecordingPlayer(audio);
  const result = observer();
  player.play("/voice.mp3", result.callbacks);
  await Promise.resolve();
  assert.deepEqual(result.events, ["请再点一下喇叭，允许播放语音"]);
  assert.equal(audio.src, "");
});

test("stalled audio loading is bounded and leaving cancels pending callbacks", async () => {
  const audio = new FakeAudio(),
    result = observer();
  const player = new RecordingPlayer(audio, 10);
  player.play("/stalled.mp3", result.callbacks);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(result.events[0], /加载超时/);
  player.play("/cancelled.mp3", result.callbacks);
  const stalePlaying = audio.onplaying!;
  player.stop();
  audio.currentSrc = "/cancelled.mp3";
  stalePlaying();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(result.events.length, 1);
});

test("cache stores full audio at its stable URL, rejects HTML and resumes cached downloads", async (t) => {
  const items = new Map<string, Response>();
  const requests: string[] = [];
  mockCaches(t, {
    open: async () => ({
      match: async (url: string) => items.get(url),
      put: async (url: string, response: Response) => {
        items.set(url, response);
      },
    }),
  } as unknown as CacheStorage);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    requests.push(input);
    return new Response(new Uint8Array(2048), {
      headers: {
        "content-type": input.includes("bad") ? "text/html" : "audio/mpeg",
      },
    });
  });
  await cacheRecording("/audio/one.mp3");
  assert.deepEqual(requests, ["/audio/one.mp3?full=1"]);
  assert.equal(items.get("/audio/one.mp3")?.status, 200);
  await cacheRecording("/audio/one.mp3");
  assert.equal(requests.length, 1);
  await assert.rejects(cacheRecording("/audio/bad.mp3"), /无法下载/);
  assert(!items.has("/audio/bad.mp3"));
});

test("cancelling a blocked cache operation releases the UI and suppresses later progress", async (t) => {
  let openCache!: (value: unknown) => void;
  mockCaches(t, {
    open: () =>
      new Promise((resolve) => {
        openCache = resolve;
      }),
  } as unknown as CacheStorage);
  const controller = new AbortController();
  const progress: number[] = [];
  const download = cacheRecordings(
    ["/audio/one.mp3"],
    (done) => progress.push(done),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(download, RequestCancelledError);
  openCache({ match: () => Promise.resolve(undefined) });
  await Promise.resolve();
  assert.deepEqual(progress, [0]);
});
