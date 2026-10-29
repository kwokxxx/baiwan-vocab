import { stat, readFile, readdir } from "node:fs/promises";
import { AUDIO_TEXTS } from "../src/audioManifest.ts";
import { SEED_ENTRIES } from "../src/entries.ts";

const actual = new Set(AUDIO_TEXTS.map(([text]) => text));
const wanted = new Set(
  SEED_ENTRIES.flatMap((entry) => [entry.term, entry.example]).filter(Boolean),
);
if (
  actual.size !== wanted.size ||
  [...wanted].some((text) => !actual.has(text))
)
  throw new Error(
    "Natural audio manifest differs from the library. Run prepare-audio and generate-audio.",
  );
let bytes = 0;
for (const [gender, voice] of [
  ["female", "af_heart"],
  ["male", "am_michael"],
]) {
  const directory = `public/audio/kokoro-v1/${gender}`;
  const metadata = JSON.parse(
    await readFile(`${directory}/voice.json`, "utf8"),
  );
  if (metadata.voice !== voice || metadata.speed !== 0.95)
    throw new Error("Unexpected natural voice: " + gender);
  const files = await readdir(directory);
  if (
    files.filter((name) => name.endsWith(".mp3")).length !== AUDIO_TEXTS.length
  )
    throw new Error("Unexpected or incomplete audio files: " + gender);
}
for (const [, key] of AUDIO_TEXTS) {
  for (const voice of ["female", "male"]) {
    const file = await stat(`public/audio/kokoro-v1/${voice}/${key}.mp3`);
    if (file.size < 512) throw new Error("Incomplete audio: " + key);
    bytes += file.size;
  }
}
// Deploy with the CLI's --archive=tgz option; check the compressed source bundle
// against the hosting upload limit before publishing as well.
if (bytes > 100_000_000)
  throw new Error("Audio assets exceed the current hosting upload budget.");
console.log(
  `Natural audio ready: ${AUDIO_TEXTS.length * 2} files, ${(bytes / 1e6).toFixed(1)} MB.`,
);
