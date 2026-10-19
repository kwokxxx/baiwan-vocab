import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { handleRequest } from "../server/handler.ts";
import { db } from "../server/db.ts";
import {
  emptyData,
  scheduleReview,
  removeEntry,
  restoreEntry,
} from "../src/study.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { newBackupCode } from "../src/backup.ts";
import { CATALOG_VERSION } from "../src/libraryVersion.ts";
import { createSession, answerSession } from "../src/session.ts";
import { resetAccountPassword } from "./lib/reset-password.ts";

const origin = process.env.CLOUD_TEST_URL ?? process.env.BETTER_AUTH_URL!;
const runId = randomUUID();
const users: string[] = [];
const backupKeys: string[] = [];
const firstEntryId = SEED_ENTRIES[0].id;
const email = `shici-qa-${runId}@example.test`;
const password = randomBytes(24).toString("base64url");
function client() {
  let cookie = "";
  return async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const request = new Request(`${origin}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "X-Shici-Protocol": "daily-v1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = process.env.CLOUD_TEST_URL
      ? await fetch(request)
      : await handleRequest(request);
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
      cookie = cookies.map((item) => item.split(";")[0]).join("; ");
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`API returned non-JSON, status ${response.status}`);
    }
    return {
      status: response.status,
      value,
      headers: response.headers,
      cookies,
    };
  };
}
try {
  const a = client(),
    a2 = client(),
    b = client(),
    anonymous = client();
  assert.equal((await anonymous("study")).status, 401);
  const health = await anonymous("health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.value, { server: "ok", database: "ok" });
  const library = await anonymous("library");
  assert.equal(library.status, 200);
  assert.equal(library.value.entries.length, SEED_ENTRIES.length);
  assert(
    library.value.entries.every(
      (entry: { example: string; translation: string }) =>
        entry.example?.trim() && entry.translation?.trim(),
    ),
  );
  assert.equal(
    library.value.entries.find(
      (entry: { id: string }) => entry.id === "phrase-ab4ca431e046dc49",
    )?.term,
    "get down to business",
  );
  assert(
    library.value.entries.some((e: { kind: string }) => e.kind === "phrase"),
  );
  console.log(
    "PASS public phrase library is available; anonymous private reads are blocked",
  );

  const signup = await a("auth/sign-up/email", {
    name: "Cloud QA",
    email,
    password,
  });
  assert.equal(
    signup.status,
    200,
    `Signup status ${signup.status}: ${signup.value.message ?? "unknown"}`,
  );
  users.push(signup.value.user.id);
  assert(signup.cookies.some((cookie) => /httponly/i.test(cookie)));
  if (origin.startsWith("https:"))
    assert(signup.cookies.some((cookie) => /secure/i.test(cookie)));
  assert.equal(
    (await a2("auth/sign-in/email", { email, password })).status,
    200,
  );
  const other = await b("auth/sign-up/email", {
    name: "Isolation QA",
    email: `other-${email}`,
    password,
  });
  assert.equal(other.status, 200);
  users.push(other.value.user.id);
  assert.equal(
    (
      await anonymous("auth/sign-in/email", {
        email,
        password: "wrong-password",
      })
    ).status,
    401,
  );
  console.log(
    "PASS registration, password login, wrong-password rejection, HttpOnly session cookies",
  );

  const data = emptyData();
  const at = Date.now();
  data.library = SEED_ENTRIES;
  data.dailyGoal = 7;
  data.reviewGoal = 3;
  data.session = createSession(SEED_ENTRIES, data, "all", at);
  data.session = answerSession(data.session, data.session.round[0], false, at);
  data.customEntries.push({
    id: `custom-${randomUUID()}`,
    kind: "word",
    term: "discover",
    meaning: "发现",
    phonetic: "",
    part: "v.",
    example: "We discover new places.",
    translation: "我们发现新的地方。",
    context: "",
    contextTranslation: "",
    related: [],
  });
  data.progress[firstEntryId] = scheduleReview(undefined, "known", at);
  data.events.push({
    id: randomUUID(),
    entryId: firstEntryId,
    at,
    rating: "known",
    isNew: true,
    hinted: false,
  });
  data.notes[firstEntryId] = "Private QA note";
  data.favorites = [firstEntryId];
  data.activeSeconds["2026-10-17"] = 42;
  data.sessionSlots = {
    all: data.session!,
    word: createSession(
      [...SEED_ENTRIES, ...data.customEntries],
      data,
      "word",
      at + 1,
    ),
    phrase: createSession(
      [...SEED_ENTRIES, ...data.customEntries],
      data,
      "phrase",
      at + 1,
    ),
  };
  const mutation = { revision: 0, mutationId: randomUUID(), data };
  const write = await a("study", mutation);
  assert.equal(write.status, 200);
  assert.equal(write.value.revision, 1);
  const secondDevice = await a2("study");
  assert.deepEqual(secondDevice.value.data, data);
  const duplicate = await a("study", mutation);
  assert.equal(duplicate.value.revision, 1);
  assert.equal(
    (await a2("study", { ...mutation, mutationId: randomUUID() })).status,
    409,
  );
  const bData = await b("study");
  assert.deepEqual(bData.value.data, emptyData());
  assert.equal(
    (await a("study", mutation, { "X-Shici-Account": users[1] })).status,
    401,
  );
  assert.equal(
    (await b("study", { ...mutation, userId: users[0], data: emptyData() }))
      .status,
    200,
  );
  assert.deepEqual((await a("study")).value.data, data);
  console.log(
    "PASS second-device readback, idempotent writes, revision conflicts, account isolation",
  );

  const privateDeletion = removeEntry(data, data.customEntries[0]);
  const sharedDeletion = removeEntry(
    privateDeletion.data,
    library.value.entries.find(
      (entry: { id: string }) => entry.id === firstEntryId,
    ),
  );
  const deleted = await a("study", {
    revision: 1,
    mutationId: randomUUID(),
    data: sharedDeletion.data,
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual((await a2("study")).value.data.customEntries, []);
  assert.equal(
    (await a2("study")).value.data.deletedEntries[firstEntryId],
    true,
  );
  assert.equal(
    (await anonymous("library")).value.entries.length,
    SEED_ENTRIES.length,
  );
  const legacy = { ...data };
  delete legacy.deletedEntries;
  delete legacy.sessionSlots;
  const oldClientWrite = await a2("study", {
    revision: deleted.value.revision,
    mutationId: randomUUID(),
    data: legacy,
  });
  assert.equal(oldClientWrite.status, 200);
  assert.equal(oldClientWrite.value.data.sessionSlots.word.kind, "word");
  assert.deepEqual(oldClientWrite.value.data.customEntries, []);
  assert.equal(oldClientWrite.value.data.progress[firstEntryId], undefined);
  assert.equal(oldClientWrite.value.data.notes[firstEntryId], undefined);
  const restored = restoreEntry(
    restoreEntry(oldClientWrite.value.data, privateDeletion.backup),
    sharedDeletion.backup,
  );
  const undone = await a("study", {
    revision: oldClientWrite.value.revision,
    mutationId: randomUUID(),
    data: restored,
  });
  assert.equal(undone.status, 200);
  assert.deepEqual((await a2("study")).value.data, restored);
  Object.assign(data, restored);
  console.log(
    "PASS private/shared-entry deletion, old-client resurrection protection and cross-session undo",
  );

  assert.equal(
    (await a("study", mutation, { Origin: "https://untrusted.example" }))
      .status,
    403,
  );
  assert.equal(
    (
      await a("study", {
        revision: 1,
        mutationId: randomUUID(),
        data: { version: 999 },
      })
    ).status,
    400,
  );
  assert.match(write.headers.get("cache-control") ?? "", /no-store/);
  const stored = await db.query(
    "SELECT data FROM study_states WHERE user_id = $1",
    [users[0]],
  );
  assert.deepEqual(stored.rows[0].data, data);
  const code = newBackupCode();
  const keyHash = createHash("sha256").update(code).digest("hex");
  backupKeys.push(keyHash);
  const bearer = { Authorization: `Bearer ${code}` };
  assert.equal((await anonymous("backups")).status, 401);
  assert.equal(
    (
      await anonymous("backups", undefined, {
        Authorization: `Bearer ${newBackupCode()}`,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await anonymous(
        "backups",
        { snapshot: data, revision: 0 },
        { ...bearer, Origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  const backed = await anonymous(
    "backups",
    { snapshot: data, revision: 0 },
    bearer,
  );
  assert.equal(backed.status, 200);
  assert.equal(backed.value.revision, 1);
  const readback = await anonymous("backups", undefined, bearer);
  assert.deepEqual(readback.value.snapshot, data);
  assert.match(readback.headers.get("cache-control") ?? "", /no-store/);
  const changedBackup = { ...data, dailyGoal: 5 };
  assert.equal(
    (
      await anonymous(
        "backups",
        { snapshot: changedBackup, revision: 1 },
        bearer,
      )
    ).status,
    200,
  );
  assert.equal(
    (await anonymous("backups", { snapshot: data, revision: 1 }, bearer))
      .status,
    409,
  );
  assert.equal(
    (await anonymous("backups", undefined, bearer)).value.snapshot.dailyGoal,
    5,
  );
  assert.equal(
    (
      await anonymous(
        "backups",
        { snapshot: { ...data, reviewGoal: -1 }, revision: 2 },
        bearer,
      )
    ).status,
    400,
  );
  const withoutCatalog = { ...data };
  assert.equal(
    (await a("study", { ...mutation, data }, { "X-Shici-Protocol": "" }))
      .status,
    426,
  );
  delete withoutCatalog.catalogVersion;
  assert.equal(
    (await a("study", { ...mutation, data: withoutCatalog })).status,
    426,
  );
  await db.query("UPDATE study_states SET data=$2 WHERE user_id=$1", [
    users[1],
    withoutCatalog,
  ]);
  const migrated = (await b("study")).value.data;
  assert.equal(migrated.catalogVersion, CATALOG_VERSION);
  assert.equal(migrated.customEntries.length, 0);
  const archive = await db.query(
    "SELECT data FROM study_state_archives WHERE user_id=$1 AND catalog_version=$2",
    [users[1], CATALOG_VERSION],
  );
  assert.deepEqual(archive.rows[0].data, withoutCatalog);
  console.log(
    "PASS full guest backup without login, secret isolation, CAS conflicts, invalid payload rejection, preserved session/plan/library, recoverable old-catalog migration",
  );

  const credentials = await db.query(
    'SELECT password FROM account WHERE "userId" = $1',
    [users[0]],
  );
  assert.notEqual(credentials.rows[0].password, password);
  assert(credentials.rows[0].password.length > 40);
  const changedPassword = randomBytes(24).toString("base64url");
  assert.equal(
    (
      await a("auth/change-password", {
        currentPassword: "wrong-password",
        newPassword: changedPassword,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a("auth/change-password", {
        currentPassword: password,
        newPassword: changedPassword,
        revokeOtherSessions: true,
      })
    ).status,
    200,
  );
  assert.equal((await a2("study")).status, 401);
  assert.equal(
    (await a2("auth/sign-in/email", { email, password: changedPassword }))
      .status,
    200,
  );
  const adminPassword = randomBytes(24).toString("base64url");
  await assert.rejects(resetAccountPassword(email, "short"));
  await resetAccountPassword(email, adminPassword);
  assert.equal((await a("study")).status, 401);
  assert.equal((await a2("study")).status, 401);
  assert.equal(
    (await a("auth/sign-in/email", { email, password: changedPassword }))
      .status,
    401,
  );
  assert.equal(
    (await a("auth/sign-in/email", { email, password: adminPassword })).status,
    200,
  );
  assert.deepEqual((await a("study")).value.data, data);
  assert.equal((await b("study")).status, 200);
  assert.equal((await a("auth/sign-out", {})).status, 200);
  assert.equal((await a("study")).status, 401);
  console.log(
    "PASS CSRF protection, validation, private cache policy, durable storage, password hashing, password change, administrator reset preserving data, session revocation, logout",
  );
} finally {
  // Delete only the accounts created by this run, never real users or the shared library.
  if (users.length)
    await db.query(
      'DELETE FROM "user" WHERE id = ANY($1::text[]) AND email LIKE $2',
      [users, `%${runId}@example.test`],
    );
  if (backupKeys.length)
    await db.query("DELETE FROM guest_backups WHERE key_hash=ANY($1::text[])", [
      backupKeys,
    ]);
  await db.end();
  console.log("Temporary test accounts cleaned up.");
}
