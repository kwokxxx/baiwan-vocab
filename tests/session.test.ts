import test from "node:test";
import assert from "node:assert/strict";
import { SEED_ENTRIES } from "../src/entries.ts";
import {
  emptyData,
  buildQueue,
  scheduleReview,
  parseBackup,
  localDay,
  upgradeDefaultGoals,
} from "../src/study.ts";
import {
  createSession,
  answerSession,
  advanceSession,
  missedInRound,
  sessionFinished,
  calendarDays,
  estimatedFinish,
  selectSession,
  reconcileSession,
  rememberSession,
} from "../src/session.ts";
import { migrateCatalog, withBundledExamples } from "../src/catalog.ts";
import { mergeStudyData } from "../src/sync.ts";
import { chooseVoice, playStudyAudio } from "../src/speech.ts";
import { newBackupCode } from "../src/backup.ts";
const now = new Date(2026, 9, 19, 21).getTime();
test("121 distinct source phrases are present, without old seed words", () => {
  assert.equal(SEED_ENTRIES.length, 121);
  assert.equal(new Set(SEED_ENTRIES.map((e) => e.id)).size, 121);
  assert(
    SEED_ENTRIES.every((e) => e.kind === "phrase" && e.meaning && !e.phonetic),
  );
  assert.equal(SEED_ENTRIES[0].term, "I hear you");
  assert.equal(SEED_ENTRIES.at(-1)?.term, "money is not everything");
});
test("every bundled phrase has a matching bilingual example, with the approved correction retaining its ID", () => {
  for (const entry of SEED_ENTRIES) {
    assert(entry.example.trim() && entry.translation.trim(), entry.term);
    assert(
      entry.example.toLowerCase().includes(entry.term.toLowerCase()),
      entry.term,
    );
    assert(/[\u4e00-\u9fff]/.test(entry.translation), entry.term);
  }
  assert.equal(new Set(SEED_ENTRIES.map((e) => e.example)).size, 121);
  assert.equal(
    SEED_ENTRIES.find((e) => e.term === "get down to business")?.id,
    "phrase-ab4ca431e046dc49",
  );
});
test("example enrichment upgrades old phrase caches without replacing personal text or changing IDs and order", () => {
  const stale = SEED_ENTRIES.map((entry) => ({
    ...entry,
    term:
      entry.id === "phrase-ab4ca431e046dc49"
        ? "go down to business"
        : entry.term,
    example: "",
    translation: "",
  }));
  stale[0].example = "My own example.";
  stale[0].translation = "自己的翻译。";
  stale[1].translation = "待补全的个人例句翻译";
  stale[2].term = "my edited phrase";
  const before = structuredClone(stale);
  const result = withBundledExamples(stale);
  assert.deepEqual(stale, before);
  assert.deepEqual(
    result.map((e) => e.id),
    stale.map((e) => e.id),
  );
  assert.strictEqual(result[0], stale[0]);
  assert.strictEqual(result[1], stale[1]);
  assert.strictEqual(result[2], stale[2]);
  assert(result.slice(3).every((entry) => entry.example && entry.translation));
  assert.equal(
    result.find((e) => e.id === "phrase-ab4ca431e046dc49")?.term,
    "get down to business",
  );
  assert.deepEqual(withBundledExamples(result), result);
  const custom = { ...stale[3], id: "custom-private-phrase" };
  assert.strictEqual(withBundledExamples([custom])[0], custom);
});
test("automatic audio speaks exactly the visible stage once and respects silence or missing examples", () => {
  const entry = SEED_ENTRIES[0];
  const played: string[] = [];
  let cancellations = 0;
  const play = (text: string) => played.push(text);
  const cancel = () => {
    cancellations++;
  };
  playStudyAudio(entry, "recall", true, play, cancel);
  playStudyAudio(entry, "detail", true, play, cancel);
  assert.deepEqual(played, [entry.term, entry.example]);
  playStudyAudio(entry, "detail", false, play, cancel);
  playStudyAudio({ ...entry, example: "  " }, "detail", true, play, cancel);
  playStudyAudio(undefined, "recall", true, play, cancel);
  assert.equal(cancellations, 3);
  assert.equal(played.length, 2);
});
test("unknown items repeat in the next group without waiting on clocks; a successful retry closes that loop", () => {
  const data = emptyData();
  data.dailyGoal = 10;
  let session = createSession(SEED_ENTRIES, data, "all", now);
  const first = session.round[0];
  for (const id of session.round)
    session = answerSession(session, id, id !== first, now);
  assert.equal(session.index, 7);
  assert.deepEqual(missedInRound(session), [first]);
  const restored = parseBackup(
    JSON.parse(JSON.stringify({ ...data, library: SEED_ENTRIES, session })),
  );
  session = advanceSession(restored.session!, SEED_ENTRIES, now + 1);
  assert.deepEqual(session.round, [first]);
  assert.equal(session.pending.length, 3);
  session = answerSession(session, first, true, now + 2);
  assert.deepEqual(missedInRound(session), []);
  assert(session.everMissed.includes(first));
  session = advanceSession(session, SEED_ENTRIES, now + 3);
  assert.equal(session.round.length, 3);
  for (const id of session.round)
    session = answerSession(session, id, true, now + 4);
  assert(sessionFinished(session));
});
test("same-day consolidation does not accelerate review to later stages or become a timed re-entry", () => {
  const first = scheduleReview(undefined, "forgot", now);
  const second = scheduleReview(first, "known", now + 20_000);
  assert.equal(second.stage, 0);
  assert.equal(second.dueAt, first.dueAt);
  assert.notEqual(localDay(second.dueAt), localDay(now));
  const d = {
    ...emptyData(),
    dailyGoal: 1,
    progress: { [SEED_ENTRIES[0].id]: second },
    events: [
      {
        id: "one",
        entryId: SEED_ENTRIES[0].id,
        at: now,
        rating: "forgot" as const,
        isNew: true,
        hinted: false,
      },
    ],
  };
  assert.deepEqual(buildQueue(SEED_ENTRIES, d, "all", now + 3600_000), []);
  assert(
    buildQueue(SEED_ENTRIES, d, "all", second.dueAt).includes(
      SEED_ENTRIES[0].id,
    ),
  );
});
test("marking an assisted entry too easy suspends it without re-adding it to a paused group's retries", () => {
  const entry = SEED_ENTRIES[0];
  const data = emptyData();
  const paused = createSession([entry], data, "all", now);
  data.progress[entry.id] = scheduleReview(undefined, "easy", now + 1, true);
  data.events.push({
    id: "hint-then-easy",
    entryId: entry.id,
    at: now + 1,
    rating: "easy",
    hinted: true,
    isNew: true,
  });
  const resumed = reconcileSession(paused, [entry], data, now + 2);
  assert.equal(data.progress[entry.id].suspended, true);
  assert.equal(resumed.results[entry.id], true);
  assert.deepEqual(missedInRound(resumed), []);
  assert(sessionFinished(resumed));
  assert.deepEqual(buildQueue([entry], data, "all", now + 86400_000), []);
});
test("new and review limits are independent; retry events do not consume extra review slots", () => {
  const d = emptyData();
  d.dailyGoal = 2;
  d.reviewGoal = 3;
  for (const e of SEED_ENTRIES.slice(0, 5))
    d.progress[e.id] = {
      ...scheduleReview(undefined, "known", now - 86400_000),
      dueAt: now - 1,
    };
  const q = buildQueue(SEED_ENTRIES, d, "all", now);
  assert.equal(q.length, 5);
  assert.deepEqual(
    q.slice(0, 3),
    SEED_ENTRIES.slice(0, 3).map((e) => e.id),
  );
  d.reviewGoal = 0;
  assert.equal(buildQueue(SEED_ENTRIES, d, "all", now).length, 2);
  assert.equal(
    createSession(SEED_ENTRIES, { ...d, dailyGoal: 20 }, "all", now, true).round
      .length,
    7,
  );
  assert.equal(
    createSession(SEED_ENTRIES, { ...d, dailyGoal: 20 }, "all", now, true)
      .pending.length,
    0,
  );
});
test("catalog replacement is idempotent and keeps historical activity while removing old custom vocabulary", () => {
  const d = {
    ...emptyData(),
    catalogVersion: undefined,
    customEntries: [{ ...SEED_ENTRIES[0], id: "custom-old" }],
    notes: { old: "note" },
    progress: { old: scheduleReview(undefined, "known", now) },
    activeSeconds: { "2026-10-18": 60 },
  };
  const migrated = migrateCatalog(d);
  assert.equal(d.customEntries.length, 1);
  assert.equal(migrated.customEntries.length, 0);
  assert.deepEqual(migrated.progress, {});
  assert.equal(migrated.activeSeconds["2026-10-18"], 60);
  assert.strictEqual(migrateCatalog(migrated), migrated);
});
test("backup and conflict merge keep library, task limits and a resumable session", () => {
  const base = emptyData();
  let session = createSession(SEED_ENTRIES, base, "all", now);
  session = answerSession(session, session.round[0], false, now + 1);
  const local = {
    ...base,
    library: SEED_ENTRIES,
    session,
    reviewGoal: 15,
    voiceURI: "Samantha",
  };
  const remote = { ...base, notes: { [SEED_ENTRIES[1].id]: "other device" } };
  const merged = mergeStudyData(base, local, remote);
  assert.equal(merged.session?.index, 1);
  assert.equal(merged.reviewGoal, 15);
  assert.equal(merged.library?.length, 121);
  assert.equal(merged.notes[SEED_ENTRIES[1].id], "other device");
  assert.deepEqual(
    parseBackup(JSON.parse(JSON.stringify(merged))).session,
    session,
  );
  assert.throws(() => parseBackup({ ...local, reviewGoal: -1 }));
  assert.throws(() =>
    parseBackup({ ...local, session: { ...session, index: 9999 } }),
  );
});
test("calendar has correct month offsets and leap-day range", () => {
  const feb = calendarDays(2028, 1);
  assert.equal(feb.filter(Boolean).length, 29);
  assert(feb.includes("2028-02-29"));
  assert.equal(calendarDays(2026, 9)[3], "2026-10-01");
});
test("female voice preference does not silently choose the first English male voice", () => {
  const voices = [
    { name: "Alex", lang: "en-US", voiceURI: "alex", localService: true },
    { name: "Samantha", lang: "en-US", voiceURI: "sam", localService: true },
  ];
  assert.equal(chooseVoice(voices)?.voiceURI, "sam");
  assert.equal(chooseVoice(voices, "alex")?.voiceURI, "alex");
  assert.equal(chooseVoice(voices.slice(0, 1)), undefined);
  const a = newBackupCode(),
    b = newBackupCode();
  assert.match(a, /^bw1_[a-f0-9]{64}$/);
  assert.notEqual(a, b);
});

test("finish estimates account for the new words already studied today", () => {
  assert.equal(
    localDay(estimatedFinish(114, 7, 10, now).date.getTime()),
    "2026-10-31",
  );
  assert.equal(
    localDay(estimatedFinish(7, 7, 7, now).date.getTime()),
    "2026-10-20",
  );
  assert.equal(estimatedFinish(0, 7, 7, now).days, 0);
});

test("mixed daily tasks include newly added words before the phrase backlog, preserving order within each type", () => {
  const words = [0, 1].map((i) => ({
    ...SEED_ENTRIES[0],
    id: `custom-word-${i}`,
    kind: "word" as const,
    term: `word${i}`,
  }));
  const entries = [...SEED_ENTRIES, ...words];
  const q = buildQueue(entries, emptyData(), "all", now);
  assert.equal(q.length, 15);
  assert.equal(q[0], words[0].id);
  assert.equal(q[1], SEED_ENTRIES[0].id);
  assert(q.includes(words[1].id));
  assert.deepEqual(
    q.filter((id) => id.startsWith("phrase-")),
    SEED_ENTRIES.slice(0, 13).map((e) => e.id),
  );
  const review = emptyData();
  review.reviewGoal = 4;
  for (const e of entries)
    review.progress[e.id] = {
      ...scheduleReview(undefined, "known", now - 86400_000),
      dueAt: now - 1,
    };
  const due = buildQueue(entries, review, "all", now);
  assert.equal(due.length, 4);
  assert(due.includes(words[0].id));
  assert(due.includes(SEED_ENTRIES[0].id));
});

test("word and phrase sessions switch to the requested type without dropping the other unfinished group", () => {
  const word = {
    ...SEED_ENTRIES[0],
    id: "custom-word",
    kind: "word" as const,
    term: "discover",
  };
  const entries = [...SEED_ENTRIES, word];
  let data = selectSession(
    entries,
    { ...emptyData(), customEntries: [word] },
    "all",
    now,
  );
  const originalRound = [...data.session!.round];
  data = rememberSession({
    ...data,
    session: answerSession(data.session!, word.id, false, now + 1),
    progress: { [word.id]: scheduleReview(undefined, "forgot", now + 1) },
    events: [
      {
        id: "mixed-forgot",
        entryId: word.id,
        at: now + 1,
        rating: "forgot",
        hinted: false,
        isNew: true,
      },
    ],
  });
  data = selectSession(entries, data, "phrase", now + 2);
  assert.equal(data.session!.kind, "phrase");
  assert(data.session!.round.every((id) => id.startsWith("phrase-")));
  assert.deepEqual(data.sessionSlots!.all!.round, originalRound);
  assert.equal(data.sessionSlots!.all!.index, 1);
  data = selectSession(entries, data, "word", now + 3);
  assert.equal(data.session!.round[0], word.id);
  assert.equal(data.session!.index, 0);
  data = rememberSession({
    ...data,
    session: answerSession(data.session!, word.id, true, now + 4),
    progress: {
      [word.id]: scheduleReview(data.progress[word.id], "known", now + 4),
    },
    events: [
      ...data.events,
      {
        id: "word-known",
        entryId: word.id,
        at: now + 4,
        rating: "known",
        hinted: false,
        isNew: false,
        practice: true,
      },
    ],
  });
  data = selectSession(entries, data, "all", now + 5);
  assert.equal(data.session!.results[word.id], true);
  assert.equal(data.session!.round[data.session!.index], SEED_ENTRIES[0].id);
  assert(data.sessionSlots!.phrase);
  assert(
    parseBackup(JSON.parse(JSON.stringify({ ...data, library: SEED_ENTRIES })))
      .sessionSlots!.word,
  );
});
test("an empty word session becomes learnable after adding the first word", () => {
  let data = selectSession(SEED_ENTRIES, emptyData(), "word", now);
  assert.equal(data.session!.round.length, 0);
  const word = {
    ...SEED_ENTRIES[0],
    id: "custom-first",
    kind: "word" as const,
    term: "discover",
  };
  data = selectSession(
    [...SEED_ENTRIES, word],
    { ...data, customEntries: [word] },
    "word",
    now + 1,
  );
  assert.deepEqual(data.session!.round, [word.id]);
  assert.equal(data.session!.index, 0);
});
test("adding words keeps the current mixed group and includes the new type in its pending task", () => {
  const data = emptyData();
  const active = createSession(SEED_ENTRIES, data, "all", now);
  const word = {
    ...SEED_ENTRIES[0],
    id: "custom-added",
    kind: "word" as const,
    term: "discover",
  };
  const changed = { ...data, customEntries: [word], session: active };
  const next = reconcileSession(
    active,
    [...SEED_ENTRIES, word],
    changed,
    now + 1,
  );
  assert.deepEqual(next.round, active.round);
  assert.equal(next.index, 0);
  assert(next.pending.includes(word.id));
  assert.equal(next.round.length + next.pending.length, 15);
});
test("extra practice and paused groups survive switching and backup validation rejects mismatched slots", () => {
  const word = {
    ...SEED_ENTRIES[0],
    id: "custom-extra",
    kind: "word" as const,
    term: "discover",
  };
  const entries = [...SEED_ENTRIES, word];
  let data = selectSession(
    entries,
    { ...emptyData(), customEntries: [word] },
    "all",
    now,
    true,
  );
  const extra = data.session!;
  data = selectSession(entries, data, "word", now + 1);
  data = selectSession(entries, data, "all", now + 2);
  assert.equal(data.session!.id, extra.id);
  assert.equal(data.session!.extra, true);
  assert.deepEqual(data.session!.round, extra.round);
  assert.throws(() =>
    parseBackup({
      ...data,
      sessionSlots: { word: { ...extra, kind: "phrase" } },
    }),
  );
});
test("15 new and 45 review defaults replace untouched 20/60 but preserve manual choices", () => {
  assert.equal(emptyData().dailyGoal, 15);
  assert.equal(emptyData().reviewGoal, 45);
  const old = { ...emptyData(), dailyGoal: 20, reviewGoal: 60 };
  assert.equal(upgradeDefaultGoals(old).dailyGoal, 15);
  assert.equal(upgradeDefaultGoals(old).reviewGoal, 45);
  const custom = { ...old, settingsUpdatedAt: now };
  assert.strictEqual(upgradeDefaultGoals(custom), custom);
  const other = { ...old, dailyGoal: 7, reviewGoal: 3 };
  assert.strictEqual(upgradeDefaultGoals(other), other);
});
