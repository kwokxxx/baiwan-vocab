import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SEED_ENTRIES } from "../src/entries.ts";
import { phraseKey } from "../src/phraseKey.ts";
import { highlightParts } from "../src/highlight.ts";
import { withLibraryAdditions } from "../src/catalog.ts";
import {
  emptyData,
  parseBackup,
  visibleEntries,
  scheduleReview,
} from "../src/study.ts";
import { createSession, reconcileSession } from "../src/session.ts";
import { StudyStore } from "../src/cloud.ts";
import {
  parsePhraseSource,
  dedupePhrases,
} from "../scripts/lib/phrase-import.ts";

test("phrase keys collapse spelling/contraction variants but preserve different tenses and wording", () => {
  assert.equal(
    phraseKey("first come, first served"),
    phraseKey("first come first served"),
  );
  assert.equal(phraseKey("it's a no-brainer"), phraseKey("it is a no brainer"));
  assert.equal(phraseKey("  You’re EXCUSED!  "), phraseKey("you are excused"));
  assert.equal(
    phraseKey("I'll be honest with you"),
    phraseKey("I will be honest with you"),
  );
  assert.equal(
    phraseKey("money isn't everything"),
    phraseKey("money is not everything"),
  );
  assert.notEqual(
    phraseKey("I had a crush on you"),
    phraseKey("I have a crush on you"),
  );
  assert.notEqual(phraseKey("keep it up"), phraseKey("keep up the good work"));
});

test("examples highlight fixed phrase fragments without speaking or displaying template placeholders", () => {
  const question = highlightParts("What do you think? We can leave tomorrow.", {
    term: "what do you think?",
    kind: "phrase",
  });
  assert.equal(
    question
      .filter((part) => part.highlighted)
      .map((part) => part.text)
      .join(""),
    "What do you think",
  );
  const pattern = highlightParts("I'm looking for a quiet café.", {
    term: "I'm looking for ...",
    kind: "phrase",
  });
  assert.equal(
    pattern.find((part) => part.highlighted)?.text,
    "I'm looking for",
  );
  const person = highlightParts("Please don't let your team down.", {
    term: "let sb. down",
    kind: "phrase",
  });
  assert.deepEqual(
    person.filter((part) => part.highlighted).map((part) => part.text),
    ["let", "down"],
  );
  assert.equal(
    person.map((part) => part.text).join(""),
    "Please don't let your team down.",
  );
});

test("source parser ignores prose notes and preserves all 1994 numbered records", () => {
  const rows = parsePhraseSource(
    readFileSync(new URL("../51133_raw_短语提取.txt", import.meta.url), "utf8"),
  );
  assert.equal(rows.length, 1994);
  assert.deepEqual(
    rows.map((row) => row.number),
    Array.from({ length: 1994 }, (_, i) => i + 1),
  );
  assert.equal(rows[0].term, "you lost me");
  assert.equal(rows.at(-1)?.term, "a touch of");
  const baseline = SEED_ENTRIES.filter(
    (entry) => !entry.id.startsWith("phrase-51133-"),
  );
  const { additions, duplicates } = dedupePhrases(rows, baseline);
  assert.equal(additions.length + duplicates.length, 1994);
  assert(
    duplicates.some(
      (row) =>
        row.term === "you're excused" && row.existing === "you are excused",
    ),
  );
  assert(!additions.some((row) => row.term === "cut to the chase"));
});

test("the final append is deduplicated, fully bilingual, and fits the cloud backup limit", () => {
  assert.equal(
    SEED_ENTRIES.filter((entry) => entry.id.startsWith("phrase-51133-")).length,
    1940,
  );
  assert.equal(
    new Set(SEED_ENTRIES.map((entry) => phraseKey(entry.term))).size,
    SEED_ENTRIES.length,
  );
  const snapshot = { ...emptyData(), library: SEED_ENTRIES };
  const encoded = JSON.stringify(snapshot);
  assert(Buffer.byteLength(encoded) < 3_000_000);
  assert.equal(parseBackup(JSON.parse(encoded)).library?.length, 2061);
  assert(SEED_ENTRIES.some((entry) => entry.term === "why are you smiling"));
  assert(!SEED_ENTRIES.some((entry) => entry.term === "why are you miling"));
  assert.equal(
    SEED_ENTRIES.filter(
      (entry) => phraseKey(entry.term) === phraseKey("you look great"),
    ).length,
    1,
  );
});

const baseline = SEED_ENTRIES.slice(0, 121);
const extra = {
  ...baseline[0],
  id: "phrase-51133-test",
  term: "you lost me",
  meaning: "你把我搞糊涂了",
  example: "You lost me. Could you explain that again?",
  translation: "你把我搞糊涂了，能再解释一遍吗？",
};

test("the original 121 entries keep their IDs, order, meanings and examples byte-for-byte", () => {
  const canonical = baseline.map((entry) =>
    Object.fromEntries(
      Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  assert.equal(
    fingerprint,
    "5643ba2f84d5c0eeaeeaa0757079dbf45be681bf65c84170d3a143227ee23cf9",
  );
});

test("cached account and pending mutation stay unchanged while full backups receive the expanded library", () => {
  const data = {
    ...emptyData(),
    library: baseline,
    dailyGoal: 7,
    reviewGoal: 21,
    settingsUpdatedAt: 1,
    notes: { [baseline[0].id]: "private note" },
  };
  const envelope = {
    data,
    base: data,
    revision: 4,
    pending: {
      revision: 4,
      mutationId: "a8c8d42c-3918-4874-a3e2-759f34e09e5d",
      data,
    },
    lastSynced: 0,
  };
  const raw = JSON.stringify(envelope);
  const values = new Map([
    [
      "shici-active-account-v1",
      JSON.stringify({
        id: "catalog-test",
        name: "Test",
        email: "catalog@example.test",
      }),
    ],
    ["shici-account-v1:catalog-test", raw],
    ["shici-cloud-library-v1:phrases-49855-v1", JSON.stringify(baseline)],
  ]);
  const storage: Storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
  const store = new StudyStore(storage, undefined, false);
  assert.equal(store.getSnapshot().library.length, SEED_ENTRIES.length);
  const full = store.fullSnapshot();
  assert.equal(full.library?.length, SEED_ENTRIES.length);
  assert.deepEqual({ ...full, library: baseline }, data);
  assert.equal(values.get("shici-account-v1:catalog-test"), raw);
  assert.deepEqual(store.getSnapshot().data, data);
});

test("old full-library snapshots gain new phrases idempotently and retain all learning state", () => {
  const data = emptyData();
  data.library = baseline;
  data.progress[baseline[0].id] = scheduleReview(
    undefined,
    "known",
    Date.now(),
  );
  data.notes[baseline[0].id] = "my own note";
  data.favorites = [baseline[0].id];
  data.deletedEntries = { [baseline[1].id]: true, [extra.id]: true };
  data.dailyGoal = 8;
  data.reviewGoal = 16;
  data.session = createSession(baseline, data, "all", Date.now());
  const before = structuredClone(data);
  const library = withLibraryAdditions(data.library, [], [extra]);
  assert.equal(library.length, 122);
  assert.deepEqual(library.slice(0, 121), baseline);
  assert.deepEqual(withLibraryAdditions(library, [], [extra]), library);
  assert.deepEqual(data, before);
  assert(!visibleEntries(library, data).some((entry) => entry.id === extra.id));
  const restored = parseBackup(
    JSON.parse(JSON.stringify({ ...data, library })),
  );
  assert.deepEqual({ ...restored, library: before.library }, before);
});

test("a personal duplicate retains its own ID/example/progress and suppresses the added shared copy", () => {
  const custom = {
    ...extra,
    id: "custom-owned",
    term: "YOU LOST ME!",
    example: "My own example.",
    translation: "自己的翻译。",
  };
  assert.deepEqual(withLibraryAdditions(baseline, [custom], [extra]), baseline);
  assert.deepEqual(
    withLibraryAdditions([...baseline, extra], [custom], [extra]),
    baseline,
  );
  const sameIdEdited = { ...extra, term: "my own changed phrase" };
  assert.equal(
    withLibraryAdditions([...baseline, sameIdEdited], [], [extra]).length,
    122,
  );
});

test("an unfinished group stays in place when new library rows arrive", () => {
  const data = emptyData();
  data.dailyGoal = 8;
  data.session = createSession(baseline, data, "all", Date.now());
  const before = structuredClone(data.session);
  const entries = withLibraryAdditions(baseline, [], [extra]);
  const resumed = reconcileSession(data.session, entries, data, Date.now());
  assert.deepEqual(resumed.round, before.round);
  assert.equal(resumed.index, before.index);
  assert.deepEqual(resumed.results, before.results);
  assert.equal(resumed.pending.length, 1);
});
