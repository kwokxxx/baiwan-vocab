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

// The web API exposes voice names, not gender. Prefer established English female
// voices when installed, and let the user audition/select the device's own voices.
export function chooseVoice<
  T extends Pick<
    SpeechSynthesisVoice,
    "name" | "lang" | "voiceURI" | "localService"
  >,
>(voices: T[], preferred = "") {
  const english = voices.filter((v) => /^en(?:[-_]|$)/i.test(v.lang));
  const selected = english.find((v) => v.voiceURI === preferred);
  if (selected) return selected;
  const names = [
    "Samantha",
    "Serena",
    "Karen",
    "Moira",
    "Tessa",
    "Ava",
    "Allison",
    "Susan",
    "Victoria",
    "Zira",
    "Jenny",
    "Aria",
    "Sonia",
  ];
  for (const name of names) {
    const voice = english.find((v) =>
      new RegExp(`\\b${name}\\b`, "i").test(v.name),
    );
    if (voice) return voice;
  }
  return english.find((v) => /female|女/i.test(v.name));
}
