import { phraseKey } from "../../src/phraseKey.ts";

export type ExtractedPhrase = {
  number: number;
  term: string;
  meaning: string;
  page: string;
};

export function parsePhraseSource(text: string): ExtractedPhrase[] {
  const rows: ExtractedPhrase[] = [];
  let page = "";
  const numbers = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    const pageMatch = line.match(/第\s*(\d+)\s*页/);
    if (pageMatch) page = pageMatch[1];
    const match = line.match(/^\s*(\d+)\.\s+(.+?)\s+—\s+(.+?)\s*$/);
    if (!match) continue;
    const number = Number(match[1]);
    if (numbers.has(number))
      throw new Error(`Duplicate source number ${number}`);
    numbers.add(number);
    rows.push({
      number,
      term: match[2].trim(),
      meaning: match[3].trim(),
      page,
    });
  }
  return rows;
}

export function dedupePhrases(
  rows: ExtractedPhrase[],
  existing: { term: string }[],
) {
  const seen = new Map(
    existing.map((entry) => [phraseKey(entry.term), entry.term]),
  );
  const additions: ExtractedPhrase[] = [];
  const duplicates: (ExtractedPhrase & { existing: string })[] = [];
  for (const row of rows) {
    const key = phraseKey(row.term);
    if (seen.has(key)) duplicates.push({ ...row, existing: seen.get(key)! });
    else {
      additions.push(row);
      seen.set(key, row.term);
    }
  }
  return { additions, duplicates };
}
