import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  scheduleReview,
  removeEntry,
  restoreEntry,
} from "../src/study.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { mergeStudyData, mergeImport } from "../src/sync.ts";

test("three-way merge preserves remote edits and local deletions", () => {
  const base = {
    ...emptyData(),
    favorites: ["word-a"],
    notes: { "word-a": "old" },
  };
  const local = { ...base, favorites: [], notes: {} };
  const remote = {
    ...base,
    favorites: ["word-a", "word-b"],
    notes: { ...base.notes, "word-b": "remote" },
    dailyGoal: 10,
  };
  const result = mergeStudyData(base, local, remote);
  assert.deepEqual(result.favorites, ["word-b"]);
  assert.deepEqual(result.notes, { "word-b": "remote" });
  assert.equal(result.dailyGoal, 10);
});
test("concurrent reviews are replayed and study time is additive", () => {
  const base = emptyData();
  const a = {
    id: "event-a",
    entryId: "word-a",
    at: 1000,
    rating: "known" as const,
    isNew: true,
    hinted: false,
  };
  const b = { ...a, id: "event-b", at: 2000, rating: "forgot" as const };
  const local = {
    ...base,
    events: [a],
    progress: { "word-a": scheduleReview(undefined, a.rating, a.at) },
    activeSeconds: { "2026-10-17": 10 },
  };
  const remote = {
    ...base,
    events: [b],
    progress: { "word-a": scheduleReview(undefined, b.rating, b.at) },
    activeSeconds: { "2026-10-17": 20 },
  };
  const result = mergeStudyData(base, local, remote);
  assert.equal(result.events.length, 2);
  assert.equal(result.progress["word-a"].reviews, 2);
  assert.equal(result.progress["word-a"].stage, 0);
  assert.equal(result.activeSeconds["2026-10-17"], 30);
});
test("repeated guest imports are idempotent and do not erase cloud notes", () => {
  const guest = {
    ...emptyData(),
    favorites: ["word-a"],
    activeSeconds: { "2026-10-17": 10 },
  };
  const remote = {
    ...emptyData(),
    notes: { "word-b": "keep me" },
    activeSeconds: { "2026-10-17": 30 },
  };
  const once = mergeImport(guest, remote),
    twice = mergeImport(guest, once);
  assert.deepEqual(twice, once);
  assert.equal(twice.notes["word-b"], "keep me");
  assert.equal(twice.activeSeconds["2026-10-17"], 30);
});

test("deletion survives offline reviews and an old backup import", () => {
  const item = SEED_ENTRIES[0];
  const base = { ...emptyData(), notes: { [item.id]: "old" } };
  const removed = removeEntry(base, item);
  const offline = {
    ...base,
    progress: { [item.id]: scheduleReview(undefined, "known", 1000) },
    favorites: [item.id],
    notes: { [item.id]: "offline edit" },
  };
  for (const merged of [
    mergeStudyData(base, offline, removed.data),
    mergeStudyData(base, removed.data, offline),
    mergeImport(offline, removed.data),
  ]) {
    assert.equal(merged.deletedEntries?.[item.id], true);
    assert.equal(merged.progress[item.id], undefined);
    assert.equal(merged.notes[item.id], undefined);
    assert.deepEqual(merged.favorites, []);
  }
  const restored = restoreEntry(removed.data, removed.backup);
  const otherChange = { ...removed.data, dailyGoal: 30 };
  const merged = mergeStudyData(removed.data, restored, otherChange);
  assert.equal(merged.deletedEntries?.[item.id], false);
  assert.equal(merged.notes[item.id], "old");
  assert.equal(merged.dailyGoal, 30);
});
