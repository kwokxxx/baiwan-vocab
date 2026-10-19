import test from "node:test";
import assert from "node:assert/strict";
import { StudyStore } from "../src/cloud.ts";
import { emptyData, STORAGE_KEY } from "../src/study.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { createSession } from "../src/session.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}
function fakeCloud() {
  let user = { id: "user-a", email: "a@example.test", name: "A" };
  const states = new Map<
    string,
    { revision: number; data: ReturnType<typeof emptyData> }
  >();
  const receipts = new Set<string>();
  let failNext = false,
    offline = false;
  const request = (async (url: string, init?: RequestInit) => {
    if (offline) throw new TypeError("Failed to fetch");
    if (url.endsWith("get-session")) return Response.json({ user });
    if (url.includes("sign-in")) {
      const b = JSON.parse(init!.body as string);
      user = {
        id: b.email.startsWith("b") ? "user-b" : "user-a",
        email: b.email,
        name: "Test",
      };
      return Response.json({ user });
    }
    if (url.endsWith("/study")) {
      let current = states.get(user.id) ?? { revision: 0, data: emptyData() };
      if (init?.method === "POST") {
        assert.equal(
          new Headers(init.headers).get("x-shici-protocol"),
          "daily-v1",
        );
        const body = JSON.parse(init.body as string);
        if (!receipts.has(body.mutationId)) {
          if (body.revision !== current.revision)
            return Response.json(
              { ...current, userId: user.id },
              { status: 409 },
            );
          current = { revision: current.revision + 1, data: body.data };
          states.set(user.id, current);
          receipts.add(body.mutationId);
          if (failNext) {
            failNext = false;
            throw new TypeError("Failed to fetch");
          }
        }
      }
      return Response.json({ ...current, userId: user.id });
    }
    return Response.json({});
  }) as typeof fetch;
  return {
    request,
    states,
    failAck: () => {
      failNext = true;
    },
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}
test("old full-library guest backups gain examples without changing progress, group, preferences or stored data", () => {
  const storage = memoryStorage();
  const data = emptyData();
  data.library = SEED_ENTRIES.map((entry) => ({
    ...entry,
    example: "",
    translation: "",
  }));
  data.notes[SEED_ENTRIES[0].id] = "keep this note";
  data.favorites = [SEED_ENTRIES[0].id];
  data.deletedEntries = { [SEED_ENTRIES[1].id]: true };
  data.activeSeconds = { "2026-10-19": 80 };
  data.dailyGoal = 9;
  data.settingsUpdatedAt = Date.now();
  data.session = createSession(SEED_ENTRIES, data, "all", Date.now());
  const raw = JSON.stringify(data);
  storage.setItem(STORAGE_KEY, raw);
  const store = new StudyStore(storage, undefined, false);
  const snapshot = store.fullSnapshot();
  assert(
    snapshot.library?.every((entry) => entry.example && entry.translation),
  );
  assert.deepEqual({ ...snapshot, library: data.library }, data);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});
test("pending write survives reload and lost acknowledgement without double-counting", async () => {
  const storage = memoryStorage(),
    cloud = fakeCloud();
  const store = new StudyStore(storage, cloud.request);
  await store.sync();
  store.save({
    ...store.getSnapshot().data,
    activeSeconds: { "2026-10-17": 15 },
    notes: { "word-a": "offline" },
  });
  cloud.failAck();
  await store.sync();
  assert.equal(store.getSnapshot().status, "error");
  const reloaded = new StudyStore(storage, cloud.request);
  await reloaded.sync();
  assert.equal(reloaded.getSnapshot().status, "synced");
  assert.equal(
    cloud.states.get("user-a")!.data.activeSeconds["2026-10-17"],
    15,
  );
  assert.equal(cloud.states.get("user-a")!.revision, 1);
});
test("offline edits retry and two devices merge independent data", async () => {
  const cloud = fakeCloud(),
    first = new StudyStore(memoryStorage(), cloud.request),
    second = new StudyStore(memoryStorage(), cloud.request);
  await first.sync();
  await second.sync();
  cloud.setOffline(true);
  first.save({ ...first.getSnapshot().data, notes: { "word-a": "first" } });
  await first.sync();
  cloud.setOffline(false);
  second.save({ ...second.getSnapshot().data, favorites: ["phrase-1"] });
  await second.sync();
  await first.sync();
  await second.sync();
  assert.deepEqual(first.getSnapshot().data, second.getSnapshot().data);
  assert.equal(first.getSnapshot().data.notes["word-a"], "first");
  assert.deepEqual(first.getSnapshot().data.favorites, ["phrase-1"]);
});
test("accounts stay separate and guest migration never destroys the guest backup", async () => {
  const cloud = fakeCloud(),
    storage = memoryStorage();
  const guest = { ...emptyData(), notes: { "word-a": "guest note" } };
  storage.setItem(STORAGE_KEY, JSON.stringify(guest));
  const store = new StudyStore(storage, cloud.request);
  await store.authenticate("login", "a@example.test", "unused", "A", true);
  assert.equal(store.getSnapshot().data.notes["word-a"], "guest note");
  await store.authenticate("login", "b@example.test", "unused", "B", false);
  assert.deepEqual(store.getSnapshot().data.notes, {});
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(guest));
});

test("browser fetch is called without binding it to the store", async () => {
  const cloud = fakeCloud();
  const request = function (
    this: unknown,
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) {
    assert.equal(this, undefined);
    return cloud.request(input, init);
  } as typeof fetch;
  const store = new StudyStore(memoryStorage(), request);
  await store.sync();
  assert.equal(store.getSnapshot().status, "synced");
});

test("logged-in records and account identity survive persisting before an update", async () => {
  const cloud = fakeCloud(),
    storage = memoryStorage();
  const store = new StudyStore(storage, cloud.request);
  await store.sync();
  cloud.setOffline(true);
  store.save({
    ...store.getSnapshot().data,
    notes: { "word-a": "尚未上传的笔记" },
  });
  assert.equal(store.persistForReload(), true);
  const reopened = new StudyStore(storage, cloud.request);
  assert.equal(reopened.getSnapshot().user?.id, "user-a");
  assert.equal(reopened.getSnapshot().data.notes["word-a"], "尚未上传的笔记");
  await store.sync();
});
test("sync releases its lock after a hanging request instead of reporting forever", async () => {
  const cloud = fakeCloud(),
    storage = memoryStorage();
  const signedIn = new StudyStore(storage, cloud.request);
  await signedIn.sync();
  const store = new StudyStore(
    storage,
    (() => new Promise(() => {})) as typeof fetch,
    true,
    10,
  );
  await store.sync();
  assert.equal(store.getSnapshot().status, "error");
  assert.match(store.getSnapshot().error, /响应超时/);
  assert.equal(store.getSnapshot().user?.id, "user-a");
});
test("diagnostics distinguish an expired login from a server connection failure", async () => {
  const request = (async (url) =>
    String(url).endsWith("health")
      ? Response.json({ database: "ok" })
      : Response.json(null)) as typeof fetch;
  const store = new StudyStore(memoryStorage(), request);
  assert.match(await store.checkConnection(), /登录已失效/);
});

test("guest edits from a second open page preserve the first page records", () => {
  const storage = memoryStorage();
  const a = new StudyStore(storage, undefined, false);
  const b = new StudyStore(storage, undefined, false);
  a.save({ ...a.getSnapshot().data, notes: { "phrase-a": "first page" } });
  b.save({ ...b.getSnapshot().data, notes: { "phrase-b": "second page" } });
  assert.deepEqual(b.getSnapshot().data.notes, {
    "phrase-a": "first page",
    "phrase-b": "second page",
  });
});
test("guest catalog migration archives the old local data before clearing its old words", () => {
  const storage = memoryStorage();
  const old = {
    ...emptyData(),
    catalogVersion: undefined,
    notes: { "word-old": "keep in archive" },
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(old));
  const store = new StudyStore(storage, undefined, false);
  assert.deepEqual(store.getSnapshot().data.notes, {});
  const archived = JSON.parse(store.previousCatalogBackup()!);
  assert.equal(archived.notes["word-old"], "keep in archive");
  assert.equal(archived.library.length, 24);
  assert(
    store.restore({ ...store.fullSnapshot(), dailyGoal: 5, reviewGoal: 15 }),
  );
  assert.equal(JSON.parse(store.previousRestoreBackup()!).dailyGoal, 15);
  assert.equal(store.getSnapshot().data.dailyGoal, 5);
});

test("upgrading untouched defaults preserves an in-flight receipt and does not double count lost acknowledgements", async () => {
  const storage = memoryStorage();
  const cloud = fakeCloud();
  const store = new StudyStore(storage, cloud.request);
  await store.sync();
  store.save({
    ...store.getSnapshot().data,
    dailyGoal: 20,
    reviewGoal: 60,
    activeSeconds: { "2026-10-19": 10 },
  });
  cloud.failAck();
  await store.sync();
  const restored = new StudyStore(storage, cloud.request);
  await restored.sync();
  assert.equal(restored.getSnapshot().data.dailyGoal, 15);
  assert.equal(restored.getSnapshot().data.reviewGoal, 45);
  assert.equal(restored.getSnapshot().data.activeSeconds["2026-10-19"], 10);
  assert.equal(
    cloud.states.get("user-a")!.data.activeSeconds["2026-10-19"],
    10,
  );
});
