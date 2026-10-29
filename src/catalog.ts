import { SEED_ENTRIES } from "./entries.ts";
import { CATALOG_VERSION } from "./libraryVersion.ts";
import type { Entry, StudyData } from "./study.ts";
import { phraseKey } from "./phraseKey.ts";

const bundled = new Map(SEED_ENTRIES.map((entry) => [entry.id, entry]));
const correctedBusinessId = "phrase-ab4ca431e046dc49";
const additions51133 = SEED_ENTRIES.filter((entry) =>
  entry.id.startsWith("phrase-51133-"),
);

// Fill old caches/backups without replacing personal text or touching study state.
// Stable IDs keep notes, deletion markers, review dates and active groups intact.
export function withBundledExamples(entries: Entry[]): Entry[] {
  return entries.map((entry) => {
    const latest = bundled.get(entry.id);
    const correctTerm =
      entry.id === correctedBusinessId && entry.term === "go down to business";
    if (
      !latest ||
      entry.kind !== latest.kind ||
      (entry.term !== latest.term && !correctTerm)
    )
      return entry;
    const fillExample = !entry.example.trim() && !entry.translation.trim();
    if (!correctTerm && !fillExample) return entry;
    return {
      ...entry,
      term: correctTerm ? latest.term : entry.term,
      ...(fillExample
        ? { example: latest.example, translation: latest.translation }
        : {}),
    };
  });
}

// New library releases append to restored/offline snapshots; they never invoke
// the older destructive catalog replacement or rewrite synchronization receipts.
export function withLibraryAdditions(
  entries: Entry[],
  customEntries: Entry[] = [],
  additions = additions51133,
): Entry[] {
  const additionIds = new Set(additions.map((entry) => entry.id));
  const customKeys = new Set(
    customEntries.map((entry) => phraseKey(entry.term)),
  );
  const result = withBundledExamples(entries).filter(
    (entry) =>
      !additionIds.has(entry.id) || !customKeys.has(phraseKey(entry.term)),
  );
  const ids = new Set([...result, ...customEntries].map((entry) => entry.id));
  const terms = new Set(
    [...result, ...customEntries].map((entry) => phraseKey(entry.term)),
  );
  for (const entry of additions) {
    const key = phraseKey(entry.term);
    if (ids.has(entry.id) || terms.has(key)) continue;
    result.push(entry);
    ids.add(entry.id);
    terms.add(key);
  }
  return result;
}

// A deliberate catalog replacement. Historical events/time remain for the calendar.
// Callers archive the untouched snapshot before committing this migration.
export function migrateCatalog(data: StudyData): StudyData {
  if (data.catalogVersion === CATALOG_VERSION) return data;
  const ids = new Set(SEED_ENTRIES.map((e) => e.id));
  const keep = <T>(map: Record<string, T>) =>
    Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
  return {
    ...data,
    catalogVersion: CATALOG_VERSION,
    library: undefined,
    customEntries: [],
    progress: keep(data.progress),
    notes: keep(data.notes),
    favorites: data.favorites.filter((id) => ids.has(id)),
    deletedEntries: keep(data.deletedEntries ?? {}),
    session: null,
    sessionSlots: undefined,
    reviewGoal: data.reviewGoal ?? data.dailyGoal * 3,
  };
}
