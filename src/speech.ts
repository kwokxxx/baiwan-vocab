import type { Entry } from "./study.ts";

// Called directly from the start/answer/next gesture, not a render effect.
export function playStudyAudio(
  entry: Pick<Entry, "term" | "example"> | undefined,
  phase: "recall" | "detail",
  enabled: boolean | undefined,
  speak: (text: string) => void,
  cancel: () => void,
) {
  const text = (phase === "detail" ? entry?.example : entry?.term)?.trim();
  if (enabled === false || !text) {
    cancel();
    return;
  }
  speak(text);
}
