import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQueue,
  createId,
  emptyData,
  INTERVALS,
  localDay,
  parseBackup,
  scheduleReview,
  removeEntry,
  restoreEntry,
  visibleEntries,
} from "../src/study.ts";
import type { Entry } from "../src/study.ts";
const now = new Date("2026-10-17T09:00:00+08:00").getTime();
const entry = (id: string, kind: "word" | "phrase" = "word"): Entry => ({
  id,
  kind,
  term: id,
  phonetic: "",
  part: "",
  meaning: "释义",
  example: "",
  translation: "",
  context: "",
  contextTranslation: "",
  related: [],
});
test("new words review on later calendar days and advance through day intervals", () => {
  let progress;
  let time = now;
  let expected: Date;
  for (let i = 0; i < INTERVALS.length + 2; i++) {
    progress = scheduleReview(progress, "known", time);
    const stage = Math.min(i, INTERVALS.length - 1);
    assert.equal(progress.stage, stage);
    expected = new Date(time);
    expected.setDate(expected.getDate() + INTERVALS[stage] / 86400_000);
    expected.setHours(0, 0, 0, 0);
    assert.equal(progress.dueAt, expected.getTime());
    time = progress.dueAt;
  }
});
test("forgotten or hinted words restart at the next day even at a mature stage", () => {
  const old = {
    stage: 6,
    dueAt: now,
    lastReviewedAt: now - 86400_000,
    lastReviewedAt: now - 86400000,
    reviews: 10,
    lapses: 2,
    suspended: false,
  };
  for (const [rating, hinted] of [
    ["forgot", false],
    ["known", true],
  ] as const) {
    const p = scheduleReview(old, rating, now, hinted);
    assert.equal(p.stage, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    assert.equal(p.dueAt, tomorrow.getTime());
    assert.equal(p.lapses, 3);
    assert.equal(old.stage, 6);
  }
});
test("due reviews are ordered first; future and suspended entries never leak into a queue", () => {
  const data = emptyData();
  data.progress.older = {
    ...scheduleReview(undefined, "known", now),
    dueAt: now - 10000,
    lastReviewedAt: now - 86400_000,
  };
  data.progress.due = {
    ...scheduleReview(undefined, "known", now),
    dueAt: now,
    lastReviewedAt: now - 86400_000,
  };
  data.progress.future = scheduleReview(undefined, "known", now);
  data.progress.easy = scheduleReview(undefined, "easy", now);
  assert.deepEqual(
    buildQueue(
      ["new", "future", "due", "older", "easy"].map((id) => entry(id)),
      data,
      "word",
      now,
    ),
    ["older", "due", "new"],
  );
});
test("words and phrases share a daily new cap, due review remains available at the cap", () => {
  const data = emptyData();
  data.dailyGoal = 1;
  data.events = [
    {
      id: "event-1",
      entryId: "word-one",
      at: now,
      rating: "known",
      isNew: true,
      hinted: false,
    },
  ];
  data.progress.phraseDue = {
    ...scheduleReview(undefined, "known", now),
    dueAt: now,
    lastReviewedAt: now - 86400_000,
  };
  const entries = [
    entry("word-one"),
    entry("phraseNew", "phrase"),
    entry("phraseDue", "phrase"),
  ];
  assert.deepEqual(buildQueue(entries, data, "phrase", now), ["phraseDue"]);
  assert.deepEqual(buildQueue(entries, data, "phrase", now + 86400000), [
    "phraseDue",
    "phraseNew",
  ]);
});
test("backup roundtrip preserves user data and rejects corrupt/dangerous content", () => {
  const data = emptyData();
  data.notes["word-examine"] = "我的联想";
  data.favorites = ["word-examine"];
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data))), data);
  assert.throws(() => parseBackup({ version: 2 }));
  assert.throws(() => parseBackup({ ...data, dailyGoal: -2 }));
  assert.throws(() =>
    parseBackup({ ...data, progress: { bad: { stage: 99 } } }),
  );
  assert.throws(() =>
    parseBackup({ ...data, notes: JSON.parse('{"__proto__":"bad"}') }),
  );
  assert.throws(() =>
    parseBackup({ ...data, customEntries: [{ id: "broken" }] }),
  );
});
test("day grouping uses device calendar boundaries, not UTC date slicing", () => {
  const date = new Date(2026, 9, 18, 0, 1);
  assert.equal(localDay(date.getTime()), "2026-10-18");
});

test("LAN preview can create record IDs without secure-context randomUUID", () => {
  const fallback = {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  };
  const first = createId(fallback);
  const second = createId(fallback);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(first, second);
});

test("deleting words or phrases removes active data and queues, undo restores it", () => {
  for (const item of [entry("word-examine"), entry("custom-test", "phrase")]) {
    const initial = emptyData();
    if (item.id.startsWith("custom-")) initial.customEntries = [item];
    initial.progress[item.id] = scheduleReview(
      undefined,
      "known",
      now - 600_000,
    );
    initial.favorites = [item.id];
    initial.notes[item.id] = "保留的笔记";
    initial.events = [
      {
        id: "history-event",
        entryId: item.id,
        at: now,
        rating: "known",
        isNew: true,
        hinted: false,
      },
    ];
    const removed = removeEntry(initial, item);
    assert.deepEqual(visibleEntries([item], removed.data), []);
    assert.deepEqual(buildQueue([item], removed.data, item.kind, now), []);
    assert.equal(removed.data.progress[item.id], undefined);
    assert.equal(removed.data.notes[item.id], undefined);
    assert.deepEqual(removed.data.favorites, []);
    assert.deepEqual(removed.data.customEntries, []);
    assert.deepEqual(removed.data.events, initial.events);
    const restored = restoreEntry(removed.data, removed.backup);
    assert.deepEqual(restored, {
      ...initial,
      deletedEntries: { [item.id]: false },
    });
    assert.deepEqual(visibleEntries([item], restored), [item]);
  }
});

test("deletion metadata round-trips and older backups remain readable", () => {
  const data = {
    ...emptyData(),
    deletedEntries: { "word-examine": true, "phrase-1": false },
  };
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(data))), data);
  const older = { ...emptyData() };
  delete older.deletedEntries;
  assert.deepEqual(parseBackup(older), older);
  assert.throws(() =>
    parseBackup({ ...data, deletedEntries: { "word-examine": "true" } }),
  );
  assert.throws(() =>
    parseBackup({ ...data, deletedEntries: JSON.parse('{"__proto__":true}') }),
  );
});
