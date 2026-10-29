import { AUDIO_TEXTS } from "./audioManifest.ts";
import { browserRequest, withDeadline } from "./network.ts";

export type NaturalVoice = "female" | "male";
export type VoiceMode = NaturalVoice | "random";
export const AUDIO_CACHE = "baiwan-natural-audio-v1";
declare global {
  var __BAIWAN_EMBEDDED_AUDIO__: Record<string, string> | undefined;
}
const keyForText = new Map(
  AUDIO_TEXTS.map(([text, key]) => [text.trim().replace(/\s+/g, " "), key]),
);

export function voiceMode(preference?: string): VoiceMode {
  return preference === "natural:female"
    ? "female"
    : preference === "natural:male"
      ? "male"
      : "random";
}
export function selectNaturalVoice(
  mode: VoiceMode,
  random = Math.random,
): NaturalVoice {
  return mode === "random" ? (random() < 0.5 ? "female" : "male") : mode;
}
export function recordingUrl(
  text: string,
  voice: NaturalVoice,
): string | undefined {
  const key = keyForText.get(text.trim().replace(/\s+/g, " "));
  if (!key) return;
  const path = `/audio/kokoro-v1/${voice}/${key}.mp3`;
  return globalThis.__BAIWAN_EMBEDDED_AUDIO__?.[path] ?? path;
}
export function recordingUrls(texts: string[]) {
  return [
    ...new Set(
      texts.flatMap((text) =>
        (["female", "male"] as const)
          .map((voice) => recordingUrl(text, voice))
          .filter((url): url is string => !!url),
      ),
    ),
  ];
}

// Cache complete responses, so Workbox can later satisfy iOS Range requests.
export async function cacheRecording(url: string, signal?: AbortSignal) {
  if (!("caches" in globalThis) || globalThis.location?.protocol === "file:")
    return;
  await withDeadline(
    async (timeoutSignal) => {
      const cache = await caches.open(AUDIO_CACHE);
      if (timeoutSignal.aborted) return;
      if (await cache.match(url)) return;
      if (timeoutSignal.aborted) return;
      const response = await browserRequest(`${url}?full=1`, {
        signal: timeoutSignal,
        credentials: "omit",
        cache: "no-store",
      });
      if (
        !response.ok ||
        response.status !== 200 ||
        !response.headers.get("content-type")?.startsWith("audio/")
      )
        throw new Error("语音文件暂时无法下载");
      const blob = await response.blob();
      if (blob.size < 512) throw new Error("语音文件不完整");
      if (timeoutSignal.aborted) return;
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.set("content-length", String(blob.size));
      await cache.put(url, new Response(blob, { status: 200, headers }));
    },
    15000,
    signal,
  );
}
export async function cacheRecordings(
  urls: string[],
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
) {
  if (!("caches" in globalThis) || globalThis.location?.protocol === "file:")
    throw new Error("请在 HTTPS 网页版中下载离线语音");
  let cursor = 0,
    done = 0;
  const batch = new AbortController();
  const cancel = () => batch.abort();
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  progress(0, urls.length);
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, urls.length) }, async () => {
        while (cursor < urls.length) {
          if (batch.signal.aborted)
            throw new DOMException("Cancelled", "AbortError");
          const url = urls[cursor++];
          await cacheRecording(url, batch.signal);
          if (batch.signal.aborted)
            throw new DOMException("Cancelled", "AbortError");
          progress(++done, urls.length);
        }
      }),
    );
  } finally {
    batch.abort();
    signal.removeEventListener("abort", cancel);
  }
}

type AudioLike = Pick<
  HTMLAudioElement,
  | "src"
  | "currentSrc"
  | "preload"
  | "onplaying"
  | "onended"
  | "onerror"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
>;
type PlaybackCallbacks = {
  start: () => void;
  end: () => void;
  error: (message: string) => void;
};

export class RecordingPlayer {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private audio: AudioLike;
  private timeoutMs: number;
  constructor(audio: AudioLike, timeoutMs = 20000) {
    this.audio = audio;
    this.timeoutMs = timeoutMs;
    audio.preload = "auto";
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.audio.onplaying = null;
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
  play(url: string, callbacks: PlaybackCallbacks) {
    this.stop();
    const generation = this.generation;
    const active = () => generation === this.generation;
    const finish = (message?: string) => {
      if (!active()) return;
      this.stop();
      if (message) callbacks.error(message);
      else callbacks.end();
    };
    this.audio.src = url;
    const source = this.audio.src;
    this.audio.onplaying = () => {
      if (active() && this.audio.currentSrc === source) {
        clearTimeout(this.timer);
        this.timer = setTimeout(
          () => finish("语音播放中断，请点喇叭重试"),
          45000,
        );
        callbacks.start();
      }
    };
    this.audio.onended = () => {
      if (this.audio.currentSrc === source) finish();
    };
    this.audio.onerror = () => {
      if (!this.audio.currentSrc || this.audio.currentSrc === source)
        finish("语音暂时无法播放，请联网后点喇叭重试");
    };
    this.timer = setTimeout(
      () => finish("语音加载超时，请点喇叭重试"),
      this.timeoutMs,
    );
    // Start synchronously inside the user's gesture, including on iOS.
    try {
      void this.audio.play().catch((error: unknown) => {
        if (!active()) return;
        finish(
          error instanceof Error && error.name === "NotAllowedError"
            ? "请再点一下喇叭，允许播放语音"
            : "语音暂时无法播放，请联网后重试",
        );
      });
    } catch {
      finish("当前浏览器暂时无法播放语音");
    }
  }
}
