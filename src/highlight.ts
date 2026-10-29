import type { Entry } from "./study.ts";

export function highlightParts(
  text: string,
  entry: Pick<Entry, "term" | "kind">,
) {
  const tokens = (
    entry.kind === "word"
      ? [
          entry.term,
          entry.term + "d",
          entry.term.endsWith("e")
            ? entry.term.slice(0, -1) + "ing"
            : entry.term + "ing",
        ]
      : entry.term.split(/\.{2,}|…+|\b(?:sb|sth)\.|\bone's\b/gi)
  )
    .map((token) => token.trim().replace(/[?!.。！？]+$/, ""))
    .filter((token) => /[a-z]/i.test(token));
  if (!tokens.length) return [{ text, highlighted: false }];
  const patterns = [...tokens]
    .sort((a, b) => b.length - a.length)
    .map((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `${/^\w/.test(token) ? "\\b" : ""}${escaped}${/\w$/.test(token) ? "\\b" : ""}`;
    });
  return text
    .split(new RegExp(`(${patterns.join("|")})`, "gi"))
    .map((part) => ({
      text: part,
      highlighted: tokens.some(
        (token) => token.toLowerCase() === part.toLowerCase(),
      ),
    }));
}
