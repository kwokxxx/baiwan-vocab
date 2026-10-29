import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { SEED_ENTRIES } from "../src/entries.ts";

const texts = [
  ...new Set(
    SEED_ENTRIES.flatMap((entry) => [entry.term, entry.example]).filter(
      Boolean,
    ),
  ),
];
const corpus = texts.map((text) => ({
  text,
  key: createHash("sha256")
    .update(text.trim().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 24),
  spoken: text
    .replace(/\bsb\./gi, "someone")
    .replace(/\bsth\./gi, "something")
    .replace(/\.{2,}|…+/g, " ")
    .replace(/\s+/g, " ")
    .trim(),
}));
if (new Set(corpus.map((item) => item.key)).size !== corpus.length)
  throw new Error("Audio key collision");
await mkdir("qa", { recursive: true });
await writeFile("qa/speech-corpus.json", JSON.stringify(corpus));
await writeFile(
  "src/audioManifest.ts",
  `// Generated from the bundled library by scripts/prepare-audio.ts.\nexport const AUDIO_TEXTS: [string, string][] = ${JSON.stringify(corpus.map(({ text, key }) => [text, key]))};\n`,
);
console.log(`Prepared ${corpus.length} texts for two natural voices.`);
